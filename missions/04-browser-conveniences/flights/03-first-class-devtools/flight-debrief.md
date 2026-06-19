# Flight Debrief: First-class DevTools

**Date**: 2026-06-19
**Flight**: [First-class DevTools](flight.md)
**Status**: landed
**Duration**: 2026-06-19 (single-day execution: 3 autonomous legs + optional HAT)
**Legs Completed**: 4 of 4 (3 autonomous + 1 optional HAT)

## Outcome Assessment

### Objectives Achieved

Goldfinch gained a first-class, user-facing way to open Chromium DevTools for the active web tab —
the gap SC5 named. Delivered:
- **Shared main-side open/close helper** (`src/main/devtools.js`, `{mode:'detach'}`) that the M03 MCP
  ops (`observe.js` `openDevTools`/`closeDevTools`) now delegate to — one code path for the mechanics.
- **Two-way `toggle-devtools`/`is-devtools-open` IPC** acting on the explicit passed `wcId` (TOCTOU
  guard), dead/internal → `false`.
- **`F12` + `Ctrl+Shift+I`** shortcuts, page-focused (main `before-input-event`) and chrome-focused
  (renderer keydown), web-content-only, auto-repeat-guarded.
- **Pinnable `#toggle-devtools` button** (`toolbarPins.devtools`, default unpinned), `aria-pressed`
  open-state with a visible gold pressed-fill, pin via Settings → Appearance + right-click, persisted
  across restart, live-updated via the `devtools-state-changed` event + on-activation reconcile.
- **Dim/disable all three pinnable buttons on internal tabs** (HAT addition — see the DD5 reframe).
- **Verification surface**: `toolbar-pins` behavior spec extended; `devtools-cdp-conflict` re-staged
  (macOS-authoritative); a11y `devtools-button` audit state; README shortcuts + CLAUDE.md notes.

Shipped: PR #60 squash-merged to `main` (`329df6d`), version bumped **0.5.4 → 0.5.5** (`b6fa9ad`),
Concourse `ci` green, **linux + windows 0.5.5 installers built and published to MinIO**.

### Mission Criteria Advanced

- **SC5 — First-class DevTools**: achieved on WSLg for the button / shortcuts / pin / persistence /
  web-content-only / dim-on-internal. **Two sub-claims remain macOS-authoritative (deferred, not
  failed):** the native detached DevTools-window materialization (works under WSLg but janky — ~1s
  close lag), and the live CDP single-client conflict (`readAxTree` → `debugger-unavailable` while
  DevTools open). Both are unit-tested at the code level; the live Chromium-substrate observation needs
  macOS (DD8).

### Checkpoints Met

4 of 5 flight checkpoints checked. The `devtools-cdp-conflict` checkpoint is left unchecked and
annotated macOS-authoritative (H9 reproduced the M03 WSLg-inconclusive result via the new affordance).

## What Went Well

- **The leg-1 event-delivery spike (DD3) paid off and corrected a generalization.** It confirmed
  `devtools-opened`/`devtools-closed` fire on **both** the guest `webContents` AND the `<webview>` tag
  — unlike Flight-2's `found-in-page` (renderer-tag only). The live `devtools-state-changed` seam was
  wired as a pre-authorized acceptable variation (no mid-flight re-litigation). Cheap insurance (5-min
  spike + pre-authorized fallback) that let a positive result be banked cleanly.
- **The shared-helper "mechanics-shared / response-per-caller" split (DD1)** is a clean template: one
  `setDevTools`/`toggleDevTools` for the open/close mechanics, the single `isInternalContents` predicate,
  but each caller applies it with its own contract (MCP ops `throw`, IPC returns `false`). Electron-free
  module, offline-unit-testable, exemplary header comment pre-empting the "why isn't the guard in the
  helper?" question.
- **The optional HAT earned its place** — it surfaced three real gaps leg design did not: (1) no visible
  pressed state, (2) off-center glyph, (3) the DD5 reframe. Two are inherently operator-found visual
  polish (Flight-1 KL#4 in action); the third became a durable architectural principle.
- **Forward-compat settings reuse** — `toolbarPins.devtools` auto-populates old config files via the
  existing normalizer, no version bump, no migration (M02 pattern correctly reused).
- **Per-design review caught real issues before implementation** every leg (stale post-Leg-1 main.js
  citations in Leg 2; the guaranteed settings-store test regression; the a11y hidden-button coverage
  caveat) — the deferred-commit, review-per-design cadence worked.

## What Could Be Improved

### Process
- **Settings-store full-map `deepEqual` under-enumeration (recurring):** Leg 2's citation audit flagged
  3 assertions needing the new `devtools` key; the suite revealed **6**. No production impact, but a
  grep for the *full-map shape* (not the first few hits) would catch all sites. Note for future
  schema-key additions.
- **HAT findings → flight-design heuristic:** add a toolbar-control checklist item to flight/leg design
  — every new control declares (a) **tab-scoped vs app-scoped**, and (b) whether it needs a visible
  **pressed/disabled** state. Two of the three HAT gaps would have been pre-empted by that lens
  (without eliminating the HAT, which catches the perceptual ones).

### Technical
- **Inline-Electron-handler test blind spot (recurring — now 3 flights):** F1 (zoom), F2 (find), F3
  (devtools) have each added `before-input-event`/chrome-keydown behavior with **zero unit coverage** of
  those branches (Leg-3 grep sweep: no test matches `before-input-event`/`keydown`/`Ctrl+Shift`). The
  `Ctrl+Shift+I`-vs-`Ctrl+Shift+P` discrimination, the F12-before-gate placement, and the auto-repeat
  guard are inspection + HAT only. Likewise the two new IPC handler shells (verbatim sibling reuse, but
  untested). This is now a structural pattern, not a one-flight gap → see Recommendations.
- **Test-metrics narrative accuracy:** the flight log states `devtools.test.js` has "8 tests"; it has
  **6** (verified). The net suite total (841) is correct; only the per-file attribution is loose. The
  real F2→F3 delta is **+7 = 6 (helper) + 1 (settings round-trip)**.
- **Pre-existing flake surfaced:** `test/unit/automation-port.test.js:226` ("freePortInRange — skips an
  occupied port") fails intermittently under full-suite parallelism (`null !== port+1`). Its assertion
  (`assert.equal(result, port+1)`) **contradicts its own comment** claiming it tolerates the collision.
  NOT a Flight-3 regression (passes 19/19 isolated). One-line fix:
  `assert.ok(result === null || result === port + 1)` or use a dedicated range.

### Documentation
- CLAUDE.md gained the DevTools-affordance note + the tab-scoped-toolbar principle, and the stale
  `{media,shields}`/"filled in as true" forward-compat sentence was corrected. README gained the
  `F12`/`Ctrl+Shift+I` rows. No further doc gaps identified.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg-1 spike came back **positive** (events fire both-sided) → live `devtools-state-changed` wired | DD3 pre-authorized the negative/on-demand-only fallback; positive was the better-case branch | Yes — the 5-min-spike + pre-authorized-fallback pattern for any `<webview>`-boundary event dependency |
| **DD5 reframed during HAT**: pinnable buttons are tab-scoped → dim/disable all 3 on internal tabs (reverses DD5's "no active-tab-type coupling" rationale; pulls M02 Media/Shields into a F3 polish change) | Operator established the tab-scoped truth; a silently-inert button is worse UX than a visibly-disabled one | Yes — "pinnable toolbar = tab-scoped only; app-scoped controls go elsewhere (menu bar); kebab is the lone exception" → now in CLAUDE.md |
| IPC handler shells + dim-on-internal + keydown branches verified by inspection/HAT, not unit tests | Inlined Electron handlers; no harness imports main.js; consistent with shipped siblings | No (accept) — but see the test-seam recommendation |
| `devtools-cdp-conflict` banners reconciled M03→M04 under DD7 authority | Stale M03-era banners contradicted each other; the live flight spec directed the re-stage | **Operator-overridable** — confirm intent (one prior banner said "deferred to Flight 6") |

## Key Learnings

1. **`<webview>` guest/host event delivery is per-event-class — spike per event, never assume.** Two
   data points now: `found-in-page` fires renderer-tag-only; `devtools-opened`/`closed` fire both-sided.
   Flight-2 D1's *verification discipline* is right, but its implied *generalization* ("guest-side
   events are unreliable") is FALSE. **Migration relevance:** the WebContentsView migration removes the
   `<webview>` tag (native host region), so any event the renderer consumes via `wv.addEventListener`
   needs a re-verified delivery path post-migration. `found-in-page` (renderer-tag-only) is
   migration-**fragile**; DevTools events (both-sided) are migration-**safe**. Log this as a concrete
   migration risk now.
2. **Behavior-test macOS-authoritative apparatus debt is now real.** `devtools-cdp-conflict` is the
   *second* macOS-authoritative-but-WSLg-deferred spec (joining the Flight-2 class). They are correctly
   *staged* but cannot be *run* — there is no macOS venue in the loop, so "macOS-authoritative"
   functionally means "permanently deferred." The unit-tested refusal path tests the *code*, not the
   *Chromium substrate* the spec exists to verify.
3. **Detached DevTools is the only mode today because `<webview>` guests have no native host region.**
   The hardcoded `{mode:'detach'}` in `src/main/devtools.js` is the single place that changes when the
   WebContentsView migration unlocks docked DevTools — that migration's headline UX win.
4. **A reframe legitimately reaches backward.** The tab-scoped principle, crystallized from concrete HAT
   use, pulled the already-landed M02 Media/Shields controls into a Flight-3 polish change. Architectural
   reframes are allowed to touch prior work when the principle demands consistency.

## Recommendations

1. **Decide a macOS run apparatus before the macOS-authoritative spec class grows further** — a periodic
   macOS session, a macOS CI runner, or an explicit operator macOS-pass gate at mission close. Without
   it, SC5's window-materialization + live-CDP-conflict bits stay unverified on the authoritative
   platform. (Most impactful — it's now a 2-spec standing debt.)
2. **Close the inline-Electron-handler test blind spot.** Either extract the keydown-dispatch logic into
   a pure `(input) → action` function both handlers call (unit-testable, covers the F12/Ctrl+Shift+I/
   collision logic), or adopt a documented "keyboard shortcuts are HAT/behavior-test-verified only"
   policy and run the extended `toolbar-pins` spec live as the regression net. Shortcut count (and
   collision surface) grows every flight.
3. **Standardize the tab-scoped toolbar principle** as a flight-design invariant for M04+ and the
   WebContentsView mission; add the toolbar-control checklist item (tab-scoped vs app-scoped? needs
   pressed/disabled state?) to leg design.
4. **Flight 4 (context menu)** must migrate the DevTools Unpin item off the native `toolbar-context-menu`
   alongside Media/Shields (DD6 deferred the native-menu clumsiness / M02 Known Issue there). Touch
   points: the `devtools` allow-guard + Unpin label map in `main.js`.
5. **Fix the `freePortInRange` test flake** (`automation-port.test.js:226`) — one-line assertion fix;
   it intermittently reds the suite under parallelism and its assertion contradicts its own comment.

## Action Items

- [ ] **macOS-authoritative pass** for SC5: live DevTools-window materialization + the
  `devtools-cdp-conflict` live run (`readAxTree` → `debugger-unavailable` while DevTools open). Carry to
  the next macOS-available window; do not let it silently lapse.
- [ ] **Confirm the `devtools-cdp-conflict` banner-reconciliation intent** (operator-overridable) — the
  re-stage was done under DD7 authority; one prior banner said "deferred to Flight 6."
- [ ] **Decide the macOS behavior-test run apparatus** (mission-level) before more macOS-authoritative
  specs accumulate.
- [ ] **Fix the `freePortInRange` flake** (`automation-port.test.js:226`).
- [ ] **Flight 4**: migrate the DevTools (+ Media/Shields) Unpin onto the custom context menu.
- [ ] **WebContentsView migration backlog**: log the `found-in-page` renderer-tag-only delivery as a
  migration-fragility risk; docked DevTools as a headline unlock (single change point:
  `src/main/devtools.js`).
- [ ] Optional: extract a pure keydown-dispatch function to close the inline-handler test gap.
