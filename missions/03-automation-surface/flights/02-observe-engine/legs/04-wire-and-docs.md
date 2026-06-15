# Leg: wire-and-docs

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Wire the four observe ops (`captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`) into
`engine.js`'s dispatch — so the existing dev seam reaches them unchanged — and clear the two
shared-surface doc/comment carry-forwards from the Flight-1 debrief: refresh the stale `input.js`
comments and add an **Automation** section to `CLAUDE.md`.

## Context

- **DD9 — exposed via the existing engine + dev seam; one entry point.** The new ops are added to
  `engine.js`'s returned dispatch object. The dev seam (`main.js:738`, `automation:dev-invoke`) calls
  `engine[op](...args)`, so adding the ops to the dispatch object **auto-exposes** them — no new seam
  surface, no `main.js` edit needed. `webContents.debugger` appears **only** in `observe.js`
  (`readAxTree`); `engine.js` itself stays debugger-free (it merely *wires* `observe.js`).
- **Deps already exist.** `engine.js:30 (deps())` already builds `{ fromId, chromeContents,
  executeInRenderer, activate }` fresh per call. The observe ops need `fromId` / `chromeContents` /
  `activate` (a superset is harmless — `executeInRenderer` is ignored by observe). So wiring is
  `observe.fn(wcId, deps())` with no new dep plumbing.
- **Shared-surface carry-forwards (Flight-1 debrief → this flight's recon).** Both are `confirmed-live`
  and touch the same `src/main/automation/` + `CLAUDE.md` surface as this flight, so they are bundled
  here (per the flight-planning bundling guideline) rather than scheduled separately:
  1. `input.js:52,63` still read **"Pending Leg 6 live confirmation"** — Flight-1 Leg 6 *confirmed* the
     click recipe works as-built; the comments are stale and must be refreshed to the confirmed finding.
  2. `CLAUDE.md` has **no automation docs** (`grep -i automation CLAUDE.md` → nothing) — the
     `src/main/automation/` engine needs a documentation section.
- **Engine churn consolidated here.** Legs 1–3 deliberately did **not** touch `engine.js`; all four ops
  land in one reviewable diff in this leg.

## Inputs

What exists before this leg runs:
- `src/main/automation/observe.js` (Legs 1–3, landed) — exports `captureScreenshot`, `captureWindow`,
  `readDom`, `readAxTree`.
- `src/main/automation/engine.js` — `createEngine(getMainWindow)`; `deps()` at `engine.js:30`; the
  returned dispatch object at `engine.js:46–61` (the `enumerateTabs`/`navigate`/`click`/… ops to
  extend); header comment at `engine.js:1–6` (incl. "No webContents.debugger anywhere in this module").
- `src/main/main.js:738` — `ipcMain.handle('automation:dev-invoke', …)` → `engine[op](...args)` (the
  seam that auto-exposes new dispatch keys; **do not edit**).
- `src/main/automation/input.js:52,63` — the two stale "Pending Leg 6 live confirmation" comments.
- `CLAUDE.md` — `## Patterns` section (subsections like `### Settings store`, `### Internal-bridge
  security model`) and a `## Flight Operations` section; **no** automation docs yet.
- `node --test test/unit/*.test.js` (391 pass after Leg 3); `npm run typecheck`; `npm run lint`.

## Outputs

What exists after this leg completes:
- `src/main/automation/engine.js` — `require('./observe')` + four new dispatch keys
  (`captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`); header comment clarified (engine
  stays debugger-free; it wires `observe.js` whose `readAxTree` is the sole debugger user).
- `src/main/automation/input.js` — the two stale comments refreshed to the confirmed finding.
- `CLAUDE.md` — a new **Automation** documentation section.
- (Optionally) `test/unit/automation-dev.test.js` or similar updated if it asserts the dispatch op set —
  check and update if present so the new ops don't break an existing "known ops" assertion.

## Acceptance Criteria
- [ ] `engine.js` `require`s `./observe` and its returned dispatch object gains **four** keys:
  - `captureScreenshot: (wcId, opts) => observe.captureScreenshot(wcId, { ...deps(), ...opts })`
    (the `opts` spread lets the Leg-5 smoke pass `{ delayMs }` to tune paint-settle without code edits;
    add a one-line comment that `opts` is intended for `delayMs`/`waitForPaint` **only** — the
    spread-after-`deps()` order means `opts` would otherwise override injected deps, a footgun if
    over-supplied),
  - `captureWindow: () => observe.captureWindow(deps())`,
  - `readDom: (wcId) => observe.readDom(wcId, deps())`,
  - `readAxTree: (wcId, opts) => observe.readAxTree(wcId, deps(), opts)` (passes the `{depth,properties}`
    stub through).
- [ ] The dev seam reaches all four **without any `main.js` edit** (verify `engine[op]` resolves for
  each new op name; the seam dispatch is unchanged).
- [ ] `engine.js` itself contains **no** `webContents.debugger` use; **both** of its debugger-free
  claims (the file-top comment block ~`engine.js:4` and the `createEngine` JSDoc ~`engine.js:14`) are
  updated so neither reads as if the *whole engine* is debugger-free after it `require`s `./observe` —
  each states `engine.js` is debugger-free and wires `observe.js`, whose `readAxTree` is the sole
  debugger user. **Keep `engine.js`'s existing DD-number convention** (it was authored in Flight 1; do
  not graft Flight-2 DD numbers into it) — or state the invariant plainly without a DD number.
- [ ] `input.js:52,63` no longer say "Pending Leg 6 live confirmation" — refreshed to state the click
  recipe (mouseMove→mouseDown(buttons:1)→mouseUp(buttons:0)) was **confirmed live in Flight-1 Leg 6**
  (the `cdp-driver` smoke). No behavioral code change in `input.js` — comments only.
- [ ] `CLAUDE.md` gains an **Automation** section covering: `src/main/automation/` is the engine home;
  the injected-deps / Electron-free-at-top convention; `webContentsId` (`wcId`) as the canonical tab
  handle; foreground-to-act + the stale-handle **re-resolve** discipline; the `executeJavaScript`
  main→guest read rationale (**not** CDP — `engine.js:35` precedent); the **debugger-only-in-
  `observe.js`/`readAxTree`** rule; the dev seam as **interim** (folded into the gated transport at
  Flight 3); and the **no-release-until-Flight-4** invariant (the surface is ungated until Flight 4 —
  nothing ships before then). **Write it in prose WITHOUT flight-scoped DD-number citations** — DD
  numbers reset per flight (Flight-1 code comments and Flight-2 specs use different numbering), so they
  are ambiguous in durable cross-flight documentation; describe the rules/rationale directly. Place it
  sensibly (e.g. a `### Automation engine` subsection under `## Patterns`, or its own `## Automation`
  section) — heading at the developer's discretion, not a contract.
- [ ] Full unit suite + `npm run typecheck` + `npm run lint` all green (no regressions; 391 baseline).

## Verification Steps
- `node --test test/unit/*.test.js` — full suite green (no regressions).
- `npm run typecheck` — clean (the engine's new dispatch entries type-check against the observe
  signatures). `npm run lint` — clean.
- Quick check: `const e = require('./src/main/automation/engine').createEngine(() => null);` then
  confirm `typeof e.captureScreenshot/​captureWindow/​readDom/​readAxTree === 'function'` (a tiny throwaway
  node one-liner, or rely on an existing engine test if one asserts the op set).
- `grep -n "Pending Leg 6" src/main/automation/input.js` → no matches.
- `grep -i automation CLAUDE.md` → the new section is present.
- `grep -rn "webContents.debugger\|\.debugger\." src/main/automation/engine.js` → no debugger use in
  engine.js.

## Implementation Guidance

1. **Engine wiring** — in `engine.js`, add `const observe = require('./observe');` next to the other
   module requires (`tabs`/`nav`/`input`), and add the four keys to the returned dispatch object
   (alongside `pressKey`), exactly as the AC specifies. Mirror the existing arrow-with-`@type`-JSDoc
   style of the surrounding dispatch entries (e.g. `click`/`scroll`) for the `wcId`/`opts` params so
   `typecheck` stays clean.
2. **Engine header** — update **both** debugger-free claims in `engine.js` (the file-top comment block
   ~line 4 and the `createEngine` JSDoc ~line 14, "No webContents.debugger anywhere in this module") to
   the clarified statement (engine stays debugger-free; wires `observe.js` whose `readAxTree` is the
   sole debugger user). Keep it short; keep engine.js's existing DD-number style (Flight-1's) or drop
   the DD number.
3. **input.js comment refresh** — at `input.js:52` and `input.js:63`, replace "Pending Leg 6 live
   confirmation." with a confirmed-finding note, e.g. "Confirmed live in Flight-1 Leg 6 (cdp-driver
   smoke): the buttons bitmask makes a page's `event.buttons` see the press." Do **not** change any
   event-building logic — comments only.
4. **CLAUDE.md Automation section** — write it from the bullet list in the AC. Keep it consistent with
   the terse, pattern-oriented voice of the existing `## Patterns` subsections. Cross-reference the
   mission/flight framing lightly (it's the automation surface), but this is *code* documentation, not a
   plan restatement.
5. **Existing-test check** — if a test asserts the exact set of engine dispatch ops (grep
   `test/unit/automation-dev.test.js` and any engine test for `enumerateTabs`/`pressKey`/an op-list),
   update it to include the four new ops so it doesn't fail on the additions. If no such assertion
   exists, no test change is needed (the observe ops are already unit-tested at the `observe.js` level;
   this leg is wiring + docs).

## Edge Cases
- **`opts` undefined for `captureScreenshot`/`readAxTree`** — `{ ...deps(), ...undefined }` is valid
  (spread of `undefined` is a no-op) and `readAxTree(wcId, deps(), undefined)` hits its
  `{ depth, properties } = {}` default. Confirm both no-arg forms work.
- **A test that pins the engine op set** — if present and not updated, the new keys make it fail (or a
  "no unexpected ops" assertion fails). Handle per step 5.
- **Header/comment drift** — do not let the `engine.js` header still claim the whole engine is
  debugger-free after it requires `observe.js`; that would be a misleading invariant.
- **Do not edit `main.js`** — the seam already dispatches dynamically; editing it would be scope creep
  and risks the dev-gate logic.

## Files Affected
- `src/main/automation/engine.js` — require observe + four dispatch keys + header clarification.
- `src/main/automation/input.js` — refresh two stale comments (no logic change).
- `CLAUDE.md` — new Automation section.
- (Possibly) `test/unit/automation-dev.test.js` — only if it asserts the dispatch op set.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

> **Batched-flight note:** This is the **last autonomous leg** in the batch. Implement to acceptance
> criteria, update the flight log, set this leg's status to `landed`, signal
> `[HANDOFF:review-needed]`. Do **NOT** commit, do **NOT** set `completed`, do **NOT** check off the
> leg/flight. The flight-level review + `completed` + all check-offs + the single commit happen next,
> after this leg lands.

- [ ] All acceptance criteria verified
- [ ] Unit suite + typecheck + lint green
- [ ] Update flight-log.md with a Leg Progress entry
- [ ] Set this leg's status to `landed`
