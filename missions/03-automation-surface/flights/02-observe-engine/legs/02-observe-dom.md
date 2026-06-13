# Leg: observe-dom

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Add `readDom(wcId, deps)` to `src/main/automation/observe.js` — a foreground-first, debugger-free read
of a target tab's full-fidelity live DOM via `wc.executeJavaScript`, returning `{ url, title, html }`;
unit-tested with fakes.

## Context

- **DD2 — DOM read via `executeJavaScript` (debugger-free), not CDP `DOM.*`.** `executeJavaScript` is
  the established main→guest path in this codebase — the precedent is `engine.js:35`
  (`mw.webContents.executeJavaScript(code)`, the chrome-renderer read the dev seam already uses); it is
  debugger-free (no single-client conflict) and works on a resolved guest `webContents` without CDP
  target discovery. **No `webContents.debugger` in this leg** — the module stays debugger-free until
  Leg 3.
  - **Correction (leg-design review):** do **not** model this on `scripts/a11y-audit.mjs` — that
    script injects axe via **CDP `Runtime.evaluate`** specifically to *bypass the page CSP*, the
    opposite mechanism. The flight's DD2 parenthetical ("the same surface `a11y-audit.mjs` uses") is
    inaccurate; the real `executeJavaScript` precedent is `engine.js:35`. Recorded in the flight log.
  - **CSP caveat (forward-looking):** `executeJavaScript` of a **self-contained expression** (property
    reads like `location.href` / `outerHTML`) runs in a privileged injected world and is **CSP-safe** —
    fine for `readDom`. Injecting a *library* (e.g. axe) under a strict `script-src` is **not**
    guaranteed safe via this path — which is exactly why `a11y-audit.mjs` went CDP. Leg 3's
    `readAxTree` must not inherit a false "executeJavaScript always works" assumption; it uses the
    debugger for the a11y tree regardless.
- **DD4 — Output shape: raw, maximally capable.** Return full `document.documentElement.outerHTML`, no
  trimming/normalization. A projection layer is a Flight-9 concern layered on top — never a default
  truncation here.
- **DD5 — Foreground-to-act, reusing Flight 1.** Guest: resolve → `await activate(wcId)` →
  **re-resolve** (stale-handle guard) → read. Chrome: always live, no activate. Identical sequence to
  Leg 1's `captureScreenshot` and `input.js:138 (actOn)`.
- **DD6 — Internal-session exclusion stays absolute.** `resolveContents` rejects internal-session
  contents before any read — so `readDom` cannot read the `goldfinch://settings` guest. Non-negotiable
  while ungated.
- **Faithfulness note (web guests run `contextIsolation: false`).** `main.js:144` sets
  `webPreferences.contextIsolation = false` for non-internal (web) guest webviews (the internal
  partition at `main.js:139` gets `true`), and `executeJavaScript` evaluates in that same page main
  world. So `outerHTML` reflects the **live, preload-and-script-mutated DOM as rendered**, not the raw
  network response — the intended "what's actually live" faithfulness, not a defect. (Farbling wraps
  *fingerprinting APIs* — script-observable values — not the static HTML, so it generally does not
  rewrite `outerHTML`; "live mutated DOM" is the precise claim.) Record this in the function JSDoc.
- **Reuse, do not re-build.** Imports `resolveContents` / `classifyContents` from `./resolve` (already
  in `observe.js` from Leg 1). No new resolution or security logic.

## Inputs

What exists before this leg runs:
- `src/main/automation/observe.js` (Leg 1, landed) — already imports `resolveContents` /
  `classifyContents`; already has the guest resolve→activate→re-resolve sequence in `captureScreenshot`
  to mirror.
- `src/main/automation/input.js:138 (actOn)` — the canonical foreground-to-act sequence.
- `src/main/main.js:144` — `webPreferences.contextIsolation = false` for web guests (the faithfulness
  basis for the JSDoc note); `main.js:139` — `true` for the internal partition.
- `test/unit/automation-observe.test.js` (Leg 1) — extend this file; reuse its `makeGuestWc` /
  `makeInternalWc` / `makeDestroyedWc` / `makeFakeFromId` / `callLog` helpers.
- `node --test test/unit/*.test.js`; `npm run typecheck`; `npm run lint`.

## Outputs

What exists after this leg completes:
- `src/main/automation/observe.js` — gains a `readDom` export (added to `module.exports`).
- `test/unit/automation-observe.test.js` — gains `readDom` cases.
- Engine wiring still **NOT** touched — `readDom` is added to `engine.js` dispatch in Leg 4.

## Acceptance Criteria
- [ ] `readDom(wcId, { fromId, chromeContents, activate })` is exported from `observe.js`; **no
  `webContents.debugger`** appears in the module.
- [ ] For a **guest**: resolves → `await activate(wcId)` → **re-resolves** → reads. For **chrome**: no
  activate. (Same sequence as `captureScreenshot`.)
- [ ] The DOM read uses `wc.executeJavaScript(...)` and returns `{ url, title, html }` where `html` is
  the **full** `document.documentElement.outerHTML` (no trimming — DD4). `url`/`title` reflect the live
  document (`location.href` / `document.title`).
- [ ] `readDom` propagates `resolveContents` rejections unchanged — bad-handle / dead /
  **internal-session** throws, and on the internal-session path **neither `activate` nor
  `executeJavaScript` is called** (DD6).
- [ ] The function JSDoc records the `contextIsolation:false` faithfulness note (outerHTML = live
  preload/farbled DOM, not the raw network response — intended, per `main.js:144`).
- [ ] `test/unit/automation-observe.test.js` gains cases for `readDom`: guest
  activate-before-executeJavaScript **ordering**, **re-resolve after activate** (the post-activate
  handle's `executeJavaScript` is the one invoked), chrome no-activate, the three resolve-rejection
  paths each asserting `executeJavaScript` call count is **0** on rejection (internal-session asserts
  **both** activate-count 0 and executeJavaScript-count 0, mirroring Leg 1's `_captureCount === 0`),
  the `{ url, title, html }` return shape, a **guest-with-no-`activate`** branch (reads without
  foregrounding when `activate` is absent), and an assertion that the exact `READ_DOM_SNIPPET` string
  is the code passed to `executeJavaScript`.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green (full suite, no regressions).

## Verification Steps
- `node --test test/unit/automation-observe.test.js` — Leg-1 cases + new `readDom` cases pass.
- `node --test test/unit/*.test.js` — full suite green.
- `npm run typecheck` — clean. `npm run lint` — clean.
- Manual read: `observe.js` still has no top-level `require('electron')` and no `webContents.debugger`.

## Implementation Guidance

1. **Add `readDom` to `observe.js`** — mirror `captureScreenshot`'s structure for the
   resolve/activate/re-resolve guest sequence:
   ```js
   async function readDom(wcId, { fromId, chromeContents, activate }) {
     let wc = resolveContents(wcId, { fromId, chromeContents });
     if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
       await activate(wcId);                                   // DD5 foreground-to-act (guest only)
       wc = resolveContents(wcId, { fromId, chromeContents }); // stale-handle re-resolve
     }
     return wc.executeJavaScript(READ_DOM_SNIPPET);
   }
   ```
2. **Single-round-trip read snippet** — one `executeJavaScript` IIFE returning the whole object so
   url/title/html are a **consistent snapshot** taken at one instant in the renderer:
   ```js
   const READ_DOM_SNIPPET = '(() => ({' +
     ' url: location.href,' +
     ' title: document.title,' +
     ' html: document.documentElement ? document.documentElement.outerHTML : "" ' +
     '}))()';
   ```
   - The `document.documentElement ? … : ""` guard handles the (rare) no-documentElement case so the
     read never throws a renderer-side TypeError.
   - **Acceptable variation** (flight): if a single IIFE proves awkward, `wc.getURL()` / `wc.getTitle()`
     (main-process reads) + a `outerHTML`-only `executeJavaScript` is acceptable — but the single-IIFE
     snapshot is preferred for consistency. Whichever, the return shape is `{ url, title, html }`.
3. **No trimming (DD4).** Return `html` whole. Do not add a default length cap. (The opt-in projection
   stub is a `readAxTree` concern in Leg 3, not here.)
4. **JSDoc** — document the deps, the return shape, the foreground-to-act sequence, and the
   `contextIsolation:false` faithfulness note (cite `main.js:144`).
5. **Export** — add `readDom` to `module.exports`.
6. **Tests** — extend `test/unit/automation-observe.test.js`. Add a fake `executeJavaScript(code)` to
   the fake wc that records the code and returns a canned `{ url, title, html }`. Reuse the Leg-1
   counter-backed `fromId` to prove re-resolve (the **second** handle's `executeJavaScript` fires).
   Mirror the internal-session "no activate, no read" assertion style from Leg 1 / `automation-input.test.js`.

## Edge Cases
- **Internal-session wcId** → `resolveContents` throws before activate/read (assert neither runs). DD6.
- **Re-resolve returns a different handle after activate** → the post-activate handle's
  `executeJavaScript` must be the one invoked (counter-backed `fromId`, as in Leg 1).
- **No `documentElement`** (e.g. a non-HTML response) → the snippet's guard returns `html: ""` rather
  than throwing; `readDom` resolves normally with an empty `html`.
- **`executeJavaScript` rejects** (renderer crashed mid-read) → let it reject; the engine/seam surfaces
  it. Do not swallow.
- **`activate` absent** (chrome-only callers) → guest path guarded by `typeof activate === 'function'`
  (matches `actOn` / Leg 1); a guest with no `activate` reads without foregrounding.
- **Huge DOM** → returned whole (DD4). Payload cost over the eventual transport is a Flight-3 concern,
  noted in DD4; not capped here.

## Files Affected
- `src/main/automation/observe.js` — add `readDom` + export.
- `test/unit/automation-observe.test.js` — add `readDom` cases.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

> **Batched-flight note:** Autonomous leg in a batched flight. Implement to acceptance criteria, update
> the flight log, set this leg's status to `landed`, signal `[HANDOFF:review-needed]`. Do **NOT**
> commit, do **NOT** set `completed`, do **NOT** check off the leg/flight. Review + `completed` +
> check-offs + commit are one flight-level pass at the end of the autonomous batch.

- [ ] All acceptance criteria verified
- [ ] Unit suite + typecheck + lint green
- [ ] Update flight-log.md with a Leg Progress entry
- [ ] Set this leg's status to `landed`
