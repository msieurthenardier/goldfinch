# Leg: verify-integration

**Status**: completed
**Flight**: [First-class DevTools](../flight.md)

## Objective

Close out the flight's verification surface: extend the `toolbar-pins` behavior spec for DevTools,
re-stage the `devtools-cdp-conflict` spec onto the new human affordance (macOS-authoritative), add a
DevTools-button a11y audit state, update the docs (README shortcuts, CLAUDE.md), and run a regression
sweep of the keyboard handlers — all with no MCP tool-count change.

## Context

- This is the flight's integration/verification leg (Legs 1–2 landed the launch mechanism + the pinnable
  button). It produces **spec + docs + audit-harness** changes plus a regression check; it does NOT add
  production browser features.
- **DD7** — Debugger single-client lock: surface the EXISTING refusal; no new UI, no new op code. This
  leg's contribution is re-staging `devtools-cdp-conflict` onto the **non-CDP human affordance** (the
  Flight-3 SC5 vector) so the conflict can finally be observed for real (macOS-authoritative).
- **DD8** — Behavior-test apparatus = the M03 automation surface; SC5's live DevTools-window + CDP
  conflict are **macOS-authoritative** (WSLg inconclusive tolerated). Pin/shortcut/button-a11y are unit +
  HAT on WSLg. **This leg authors/extends specs and updates the harness; it does NOT run the
  macOS-authoritative behavior test on WSLg** — the definitive run is the optional HAT / a future macOS
  pass, consistent with how Flights 1–2 deferred macOS-authoritative items.
- **Leg-2 a11y deferral**: the DevTools button is hidden-by-default, so the default a11y sweep skips it.
  Adding the pin-the-button audit state (the Flight-2 "5th state-driver" precedent, now a 6th) is THIS
  leg's job.

## Inputs

What exists before this leg runs (Legs 1–2 landed):
- The full launch mechanism + pinnable button (Legs 1–2) in the working tree.
- `tests/behavior/toolbar-pins.md` — the Media+Shields pin behavior spec (status `draft`); admin-MCP
  apparatus; dual-target (chrome toolbar + internal settings guest) structure.
- `tests/behavior/devtools-cdp-conflict.md` — status `archived` (a recorded finding from goldfinch's
  **M03** automation mission; run via the M03 MCP `openDevTools` tool, inconclusive under WSLg). **Carries
  several stale status banners that reference M03-era flight numbers** (e.g. "Flight 9 / leg
  devtools-tool", "Flight 3 / leg behavior-test-specs", "Flight 6 (behavior-spec migration)") — these
  predate M04 and must be reconciled, not blindly trusted (see Edge Cases + the operator flag in
  Implementation Guidance).
- `tests/behavior/devtools-cdp-conflict/runs/2026-06-17-16-25-30.md` — the prior MCP-`openDevTools` run
  log (the recorded M03 finding) — **keep as a prior-finding; do NOT delete**.
- `scripts/a11y-audit.mjs` — the chrome N-state sweep (`main()` ~`:225-294`): base-chrome, media-panel,
  privacy-panel, lightbox, find-bar states, each driven by `evaluate(client, wcId, '<renderer fn>')` then
  `runAxe(…, 'state-label')`. Accepted-allowlist partitioning (`:299+`).
- `README.md` — `## Keyboard shortcuts` table (`README.md:141-160`); zoom/find/print rows present, **no
  DevTools row**.
- `CLAUDE.md` — `toolbarPins` setting + `applyToolbarPins` + `cdp.js` single-client-lock notes
  (`CLAUDE.md:95-111`, `:155`); no DevTools-affordance note yet.
- `src/main/main.js` `before-input-event` (the F12 / Ctrl+Shift+I / zoom / print / find branches) and
  `src/renderer/renderer.js` chrome keydown (the F12 / Ctrl+Shift+I / Ctrl+F / Ctrl+M / etc. chain) — the
  regression-sweep targets.

## Outputs

What exists after this leg completes:
- `tests/behavior/toolbar-pins.md` — extended with DevTools steps mirroring Media/Shields: pin/unpin from
  Settings → Appearance + right-click, persistence across restart, the unpinned-`F12`/`Ctrl+Shift+I`
  shortcut still opening DevTools, and the inert-not-hidden-on-internal behavior. Title/Intent updated to
  name DevTools as the third pinnable item. (Spec text only — not run here.)
- `tests/behavior/devtools-cdp-conflict.md` — **re-staged**: status →
  `active — macOS-authoritative; WSLg inconclusive tolerated`; the stale M03 banners reconciled into one
  clear M04-Flight-3 re-stage note; the `Act` path (steps 3/4) rewritten to open/close DevTools via the
  **new human affordance** (the `F12`/button → `toggle-devtools` IPC, the canonical SC5 vector) instead of
  the MCP `openDevTools`/`closeDevTools` tools; the prior MCP-`openDevTools` run log preserved and
  referenced as a prior-finding; the `Observables Required` + apparatus notes updated to reflect the
  human-affordance act path.
- `scripts/a11y-audit.mjs` — a 6th audit state (`devtools-button`): pin DevTools (un-hide the button via
  `applyToolbarPins({media:true,shields:true,devtools:true})`), audit, so the button's static a11y
  (accessible name, valid `aria-pressed`, no `aria-expanded`) is actually exercised by `npm run a11y`.
- `README.md` — `F12` and `Ctrl+Shift+I` rows in the Keyboard-shortcuts table; a short DevTools mention in
  the relevant section if warranted.
- `CLAUDE.md` — a DevTools-affordance note (the human path: `toggle-devtools`/`is-devtools-open` IPC +
  the shared `src/main/devtools.js` helper + the `toolbarPins.devtools` item + the `F12`/`Ctrl+Shift+I`
  shortcuts), placed near the existing `toolbarPins`/`cdp.js` notes.
- A recorded **regression sweep** result (in the flight log): the new F12/Ctrl+Shift+I branches do not
  break the existing zoom (`Ctrl +/-/0`), print (`Ctrl+P`), find (`Ctrl+F`), or tab (`Ctrl+T/W/L/R/M`)
  shortcuts in either handler.

## Acceptance Criteria

- [x] `tests/behavior/toolbar-pins.md` includes DevTools steps covering: pin via Settings → Appearance,
  unpin via right-click, persistence across restart, unpinned-shortcut-still-works, inert-on-internal —
  mirroring the existing Media/Shields steps. Spec validates against the ARTIFACTS.md behavior-spec shape
  (Intent, Preconditions, Observables Required, Steps table, Out of Scope present).
- [x] `tests/behavior/devtools-cdp-conflict.md` status is `active — macOS-authoritative; WSLg inconclusive
  tolerated`; its `Act` path opens DevTools via the human affordance (button/shortcut → IPC), NOT the MCP
  `openDevTools` tool; the prior run log is still present and referenced as a prior-finding; the stale M03
  banners are reconciled into one coherent current note.
- [x] `scripts/a11y-audit.mjs` drives a `devtools-button` state (DevTools pinned/visible) and `npm run
  a11y` reports **no new violations** in that state (the button has an accessible name + valid
  `aria-pressed`). *(Positively confirmed over the MCP surface: pinning un-hides `#toggle-devtools`;
  accessible name "DevTools", `aria-pressed="false"`, no `aria-expanded`.)*
- [x] `README.md` Keyboard-shortcuts table has `F12` and `Ctrl+Shift+I` rows (action: open/toggle
  DevTools for the active web tab).
- [x] `CLAUDE.md` documents the DevTools human affordance (helper + IPC + pin item + shortcuts).
- [x] Regression sweep recorded: zoom/print/find/tab shortcuts still work after the F12/Ctrl+Shift+I
  additions (verified by the existing unit tests for those handlers + a targeted manual/inspection check;
  noted in the flight log). *(No isolated handler unit test exists — inspection-only; see flight log.)*
- [x] `npm test`, `npm run typecheck`, `npm run lint` pass; `npm run a11y` clean (incl. the new state).
- [x] **MCP tool count unchanged (still 26)** — this leg adds no automation tools.

## Verification Steps

- **toolbar-pins spec shape**: re-read `tests/behavior/toolbar-pins.md` — confirm the DevTools steps exist
  and the required sections are intact. (Authoring check, not a run — the live run is the HAT / future
  macOS pass.)
- **devtools-cdp-conflict re-stage**: confirm the status line, the human-affordance `Act` path, the
  preserved prior run-log reference, and that the banners are coherent (no contradictory M03-vs-M04
  claims).
- **a11y new state**: `npm run a11y` (admin key, live MCP surface) — confirm a `devtools-button` state is
  audited and reports no new violations. Inspect the harness diff to confirm the state pins DevTools
  before auditing.
- **README/CLAUDE**: visual check the new rows/notes render and are accurate.
- **Regression**: `npm test` (the `before-input-event` / keydown handler unit tests stay green); inspect
  both handlers to confirm the F12 branch placement did not displace the zoom/print/find branches.
- `npm test` / `npm run typecheck` / `npm run lint` / `npm run a11y`.

## Implementation Guidance

1. **Extend `toolbar-pins.md`** — add DevTools steps modeled on the existing Media/Shields rows. Keep the
   admin-MCP apparatus + dual-target structure. New coverage: (a) Settings → Appearance `#pin-devtools`
   toggles persistence; (b) the chrome toolbar `#toggle-devtools` `.hidden` reflects the pin live; (c)
   right-click "Unpin DevTools"; (d) unpinned, `F12`/`Ctrl+Shift+I` still opens DevTools (assert via
   `is-devtools-open` / `isDevToolsOpened`); (e) DevTools default is **unpinned** (unlike Media/Shields)
   — the initial state assertion must expect `devtools:false`. Update the Title/Intent to name DevTools as
   the third pinnable item and note its unpinned default. **Live button-state assertions are safe**: Leg 1's
   spike was POSITIVE and wired the `devtools-state-changed` event (flight log), so the button reflects
   open/closed live (incl. a DevTools-window-initiated close) — the spec may assert live pressed-state
   without a max-staleness caveat (the on-activation `isDevtoolsOpen` reconcile is the backstop, not the
   primary path). Note the new harness `devtools-button` a11y state (Impl step 3) and this spec's own
   `npm run a11y` step are **complementary** (the spec audits the pinned-default chrome; the harness state
   audits the DevTools-pinned chrome) — neither supersedes the other. Do NOT run the spec here.

2. **Re-stage `devtools-cdp-conflict.md`** —
   - Status line → `**Status**: active — macOS-authoritative; WSLg inconclusive tolerated`.
   - **Reconcile the banners**: the existing top banners reference goldfinch **M03**-era flight numbers
     (Flight 9 run, "Flight 3/Flight 6" sequencing) and are now stale. Replace them with ONE clear note:
     this spec is re-staged by **M04 Flight 3 (First-class DevTools), leg `verify-integration`**, now that
     a non-CDP human affordance exists; the prior M03 MCP-`openDevTools` run (link the run log) is retained
     as a prior-finding; the definitive live observation is **macOS-authoritative** (WSLg could not cleanly
     materialize the detached DevTools window). Do not delete the historical finding — frame it as prior.
   - **Rewrite the `Act` path** (steps 3/4): open DevTools via the **human affordance** — the `F12`
     shortcut or the `#toggle-devtools` button → the `toggle-devtools` IPC (the SC5 vector). Where the spec
     previously called the MCP `openDevTools(W)`/`closeDevTools(W)` tools to establish the DevTools-open
     condition, drive it through the human path instead (e.g. for an automated apparatus, the chrome
     renderer's `toggleDevtools({webContentsId:W})` via the admin chrome target, or document the HAT
     keystroke). Keep the **observe** path unchanged: `readAxTree(W)` → record `debugger-unavailable`
     /`attach-failed` vs array; `evaluate`/`injectScript` still work; close → restores. It remains a
     **recorded finding**, not a pass/fail gate.
   - Update `Observables Required` + the apparatus note to reflect the human-affordance act path (the
     `chrome-devtools` MCP must still NOT be used — same double-disqualification reasoning).
   - **FLAG TO OPERATOR** (surface in the flight log + the FD report): the existing banners' contradictory
     M03/M04 references were reconciled by this leg under the authority of the M04 F3 flight spec (DD7).
     If the operator intended this spec to stay deferred (one stale banner said "deferred to Flight 6"),
     they can override — but the live flight spec directs the re-stage.

3. **Add the a11y `devtools-button` state** to `scripts/a11y-audit.mjs` `main()` (append as the 6th
   state, after the find-bar state which ends ~`:293`). `applyToolbarPins` is a top-level
   `function applyToolbarPins(...)` in `renderer.js:1725` — reachable as a window global in the audit's
   executeJavaScript main world exactly like `togglePanel`/`openFind`/`closeLightbox`, and it already
   reads `pins.devtools` and toggles `.hidden` on `els.toggleDevtools` (Leg 2), so pinning DOES un-hide
   the button for axe. Mirror the existing pattern:
   ```js
   // 6) DevTools button visible (pin it; default is unpinned so the toolbar button is .hidden).
   // Audits the button's static a11y — accessible name + valid aria-pressed (NOT aria-expanded).
   // The find-bar state (state 5) leaves the find bar OPEN; close it so unrelated find nodes
   // don't pollute this state. closeFind REQUIRES the active-tab arg (renderer.js:1863) — passing
   // none is a silent no-op, so pass activeTab().
   await evaluate(client, wcId, 'closeFind(activeTab())');
   await sleep(200);
   await evaluate(client, wcId, "applyToolbarPins({ media: true, shields: true, devtools: true })");
   await sleep(400);
   allViolations.push(...(await runAxe(client, wcId, axeSource, 'devtools-button')));
   ```
   Confirm `closeFind`/`activeTab` are reachable globals (they are top-level fns) before relying on them;
   if `closeFind(activeTab())` proves awkward, any equivalent that actually closes the find bar is fine —
   the requirement is "no transient overlay (find bar / lightbox) open when this state is audited", not the
   specific call. Do NOT attempt to actually OPEN DevTools in the audit (no detached window in the gate) —
   the button's unpressed static a11y is the target. (The sweep mutates live toolbar visibility and does
   not restore the default pin state afterward — harmless, since the client closes immediately after this
   last state; note it in a code comment.)

4. **README** — add to the Keyboard-shortcuts table (`README.md:143-160`), near the find/zoom rows:
   ```
   | `F12`           | Open/close DevTools (active web tab) |
   | `Ctrl+Shift+I`  | Open/close DevTools (active web tab) |
   ```
   Add a one-line note (mirroring the zoom note at `:162`) that DevTools targets web content only (inert
   on `goldfinch://`) and opens in a native detached window; mention the pinnable toolbar button (default
   unpinned).

5. **CLAUDE.md** — TWO edits (not additive-only):
   - **Correct the now-stale `toolbarPins` description** (`:95`, `:97`): the note says `toolbarPins: {
     media: true, shields: true }` and "When a future 3rd pinnable item is added … filled in as `true`
     (pinned) automatically". DevTools is now that 3rd item and it defaults `false` (DD4), so the existing
     text is internally contradicted. Update the map to `{ media: true, shields: true, devtools: false }`
     and fix the forward-compat sentence (the normalizer fills a missing key with its DEFAULTS value,
     which for `devtools` is `false`, not `true` — the "filled in as true" claim was specific to the
     media/shields era and is wrong as a general rule). Keep the validator/normalizer mechanics
     description intact (still accurate).
   - **Add a DevTools-affordance note** near those notes (`:95-111`) and/or the `cdp.js` lock note
     (`:155`): the human path is `window.goldfinch.toggleDevtools`/`isDevtoolsOpen` (two-way IPC) →
     `toggle-devtools`/`is-devtools-open` handlers → the shared `src/main/devtools.js` helper
     (`{mode:'detach'}`, web-content-only via `isInternalContents`); the MCP `openDevTools`/`closeDevTools`
     ops call the same helper; `toolbarPins.devtools` (default `false`) + the `F12`/`Ctrl+Shift+I`
     shortcuts (work regardless of pin state); the Leg-1 `devtools-state-changed` event drives live button
     state; open DevTools ⇒ the `cdp.js` single-client lock surfaces `debugger-unavailable` to the CDP ops
     (`readAxTree`/`scroll`), the CDP-free ops keep working (cross-reference the existing `:155` note).

6. **Regression sweep** — run `npm test` and confirm the handler unit tests stay green. Then **first
   locate** which unit test file (if any) exercises the gated `before-input-event` / chrome-keydown
   branches (grep `test/` for `before-input-event`, `keydown`, `Ctrl+Shift`, `zoom-apply`, `open-find`).
   If a test asserts the `Ctrl+Shift+I`-vs-`Ctrl+Shift+P` discrimination, name it in the flight log; if
   **none** does (likely — these are inlined Electron handlers, see Leg-1's note that they aren't
   unit-tested in isolation), say so explicitly and make the **code-inspection** the recorded check:
   inspect `src/main/main.js` `before-input-event` (F12 between the keyDown filter and the modifier gate;
   Ctrl+Shift+I in the gated section) and `src/renderer/renderer.js` keydown (F12 before `if (!mod)
   return;`; Ctrl+Shift+I as a chain `else if`) to confirm the F12 branch did not displace the
   zoom/print/find branches and `Ctrl+Shift+I` does not collide with `Ctrl+Shift+P` (key letter
   disambiguates). Do not imply `npm test` covers the collision if no test actually does. Record the
   result (test names or "inspection-only, no isolated handler test exists") in the flight log.

## Edge Cases

- **Stale M03 banners on `devtools-cdp-conflict.md`** — the spec is project-owned and its existing status
  banners reference a different mission's flight numbering. Reconcile under the M04 F3 flight-spec
  authority (DD7) but FLAG it; do not silently rewrite history — preserve the prior run as a prior-finding.
- **a11y state pollution** — the `devtools-button` state runs after find-bar; ensure find/lightbox are
  closed first (mirror the find-bar state's `closeLightbox()` cleanup) so the audited DOM is clean. Pinning
  DevTools does not open a panel, so no mutual-exclusion concern with media/privacy.
- **No live macOS run here** — do NOT mark the `devtools-cdp-conflict` outcome as observed/confirmed on
  WSLg; the leg only re-stages the spec. Asserting a WSLg result would repeat the M03 inconclusive trap.
- **Tool count** — adding behavior specs / docs / an audit state must not touch `mcp-tools.js`; assert it
  mechanically: `grep -cE "name:\s*['\"]" src/main/automation/mcp-tools.js` → `26` (don't eyeball it).
- **Behavior specs are authored, not run, in this leg** — per DD8, the live runs are the optional HAT
  (operator-driven) + a future macOS pass. The FD may separately invoke `/behavior-test toolbar-pins` if a
  live WSLg run is wanted, but it is not this leg's acceptance gate.

## Files Affected

- `tests/behavior/toolbar-pins.md` — DevTools steps + Intent/Title.
- `tests/behavior/devtools-cdp-conflict.md` — status, banners, Act path, observables/apparatus.
- `scripts/a11y-audit.mjs` — `devtools-button` audit state.
- `README.md` — Keyboard-shortcuts rows + DevTools note.
- `CLAUDE.md` — DevTools-affordance note.
- (No production source changes; no `mcp-tools.js` / tool-count change.)

---

## Post-Completion Checklist

*(Deferred-commit workflow: this is the LAST autonomous leg — land it `in-flight`→`landed`, update the
flight log, do NOT commit; the flight-level review + commit + PR happen after this leg, driven by the
Flight Director. Do NOT mark the flight `landed` or check it off in the mission — the FD does that at
flight completion.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y`)
- [x] Update flight-log.md with the Leg 3 progress entry + the regression-sweep result + the
  devtools-cdp-conflict banner-reconciliation flag
- [x] Set this leg's status to `landed`

## Citation Audit

Citations verified against current code at leg design time:
- `tests/behavior/toolbar-pins.md` (status draft, admin-MCP dual-target structure) — `OK`.
- `tests/behavior/devtools-cdp-conflict.md` (status `archived`, M03-era banners, MCP-`openDevTools` Act
  path, steps 1–4) — `OK`; prior run log `tests/behavior/devtools-cdp-conflict/runs/2026-06-17-16-25-30.md`
  present.
- `scripts/a11y-audit.mjs` `main()` body (`:225-294`); 5-state sweep states at `:268-293` (base-chrome
  `:269`, find-bar `:286-293`); `evaluate`→`runAxe` per state — `OK`.
- `README.md:141-160` Keyboard-shortcuts table (no DevTools row), `:162` zoom note — `OK`.
- `CLAUDE.md:95-111` toolbarPins/applyToolbarPins notes, `:155` cdp.js single-client-lock note — `OK`.
- Handler regression targets: `src/main/main.js` before-input-event + `src/renderer/renderer.js` keydown
  (F12/Ctrl+Shift+I added in Leg 1) — `OK` (present in working tree).
