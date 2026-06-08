# Flight Debrief: Settings Page Shell + Address-Bar Chips

**Date**: 2026-06-07
**Flight**: [Settings Page Shell + Address-Bar Chips](flight.md)
**Status**: landed
**Duration**: 2026-06-07 (single agentic session via `/agentic-workflow`)
**Legs Completed**: 8 of 8

## Outcome Assessment

### Objectives Achieved
Enriched `goldfinch://settings` from the Flight-4 stub into a Chrome-style settings shell (sticky
section-nav + five titled sections + placeholder content), extended the internal protocol handler to serve
CSS/JS subresources under the unchanged strict CSP, and added the full address-bar surface — an
internal-page identity chip, a web-page site-info chip + popup, and an internal-tab navigation lock. The
Flight-3 menu-keyboard-contract debt (DD7) was paid down as the lead leg. All offline gates green
(182/182, lint, typecheck); the `settings-shell` behavior test passed 12/12 live; a11y clean on both the
chrome and the `goldfinch://settings` guest.

### Mission Criteria Advanced
- **SC6** (recognizable modern-browser settings layout) — **met and verified live** (shell DOM read via
  guest CDP; behavior test 12/12; guest a11y clean).
- **SC8** (keyboard-operable; no new WCAG A/AA violations) — **met** after the `role="search"` landmark fix
  (chrome + guest a11y both clean vs the pinned `ACCEPTED` baseline).
- Discharged the **UX half** of the Flight-4 "internal tab is freely web-navigable" Known Issue (the
  identity chip + the navigation lock). The **security-critical bridge origin-check remains Flight 6**.

### Checkpoints
All six In-Flight checkpoints met: menu hoist + suites intact; subresources serve with correct
content-types + CSP unchanged; shell with sidenav/sections/a11y; chips + popup; internal-tab lock; behavior
test + regressions + offline gates.

## What Went Well

- **Convention adherence was strong.** `internal-assets.js` is a pure, Electron-/`__dirname`-free CommonJS
  module mirroring `download-path.js` (21 unit tests against a synthetic map); the `els` map, the
  `menuController` registration pattern, and CSP discipline (`INTERNAL_CSP` unchanged, zero inline
  style/script) were all honoured.
- **The DD7 menu-keyboard hoist landed cleanly as the lead leg** — net **−21 lines** in `renderer.js`
  (55 added / 76 deleted, the signature of a real refactor), sequenced first so any destabilization would
  surface before legs 2–5 built on the controller. It didn't destabilize.
- **`menuController` proved to be the right abstraction.** It now serves three heterogeneous consumers —
  two roving APG menus and one non-menu popup — via the `!entry.items` guard, with mutual-exclusion and
  outside-dismiss as free benefits and no contortion of the popup into a `role="menu"`.
- **The DD2 CSP-subresource spike was correctly de-risked.** Deferred to leg 7 with a one-line fallback
  documented; the live confirm **passed** (css applied + js executed under the unchanged `default-src
  'self'`), retiring the risk without the fallback ever being needed.
- **Live verification earned its place.** The offline suite was green at 182/182, yet the real defects
  (the `region` a11y regression and two Shields-panel internal-tab bugs) surfaced only in the live leg-7
  audit and the HAT — vindicating the flight's live-acceptance design.
- **Leg specs were high-fidelity.** Edge-case notes were load-bearing (the `focusItem`-NaN guard; the
  `readOnly`-doesn't-block-programmatic-writes clarification; the `tab.privacy.net === null` null-safety;
  "use `<body>` as the scroll container to avoid `scrollable-region-focusable`"). Scope boundaries between
  legs 4 and 5 (chip render vs chip click) were clean — no gaps, no duplication.

## What Could Be Improved

### Process
- **DD4 stated an a11y-baseline fact that was wrong.** It claimed `#address-wrap` was already in the pinned
  `ACCEPTED` allowlist; the allowlist held only `#tabs`/`#brand`. Adding the chip surfaced **4 NEW `region`
  violations** at leg-7 (not at leg 4, where the chip was added) — a fix that, had it been harder, could
  have blocked landing. **Lesson**: verify a11y-baseline assumptions against the actual `ACCEPTED` list at
  design time rather than recalling from memory; the a11y gate is live-only, so a new interactive node in a
  previously-unaudited region should be flagged at the leg design review as "likely to need landmark
  attention" (the design review is the only pre-live signal).
- **The guarded-rule was misidentified.** Leg 4 named `button-name` as the a11y risk; the rule that
  actually fired was `region` (an un-landmarked container exposed by adding a labelled child). The
  mechanism — *adding an interactive child to a non-landmark container surfaces the container* — is a
  generalizable pitfall worth carrying forward.

### Technical
- **`HOMEPAGE` is still a hardcoded `renderer.js` constant.** The "On startup / Home page" section is a
  placeholder. Promoting it (Flight 6) is more involved than the stub implies: a persisted store + a
  read/write IPC pair on *two* preloads (chrome + internal bridge) + updating the `createTab(HOMEPAGE, …)`
  call sites + loading it at startup. Scope it explicitly in the Flight 6 design rather than discovering
  the constant at implementation time.
- **`menuController` remains an in-`renderer.js` IIFE, not a unit-testable module.** This is a
  carry-forward from the Flight-3 debrief (Rec 5). The controller now owns the full APG keyboard contract
  and three consumers; if Flight 6 adds a fourth, graduate it to a module (`src/renderer/menu-controller.js`
  or `src/shared/`) and add the mutex/recursion unit test **before** the next consumer, not after.
- **`isInternalTab` couples to a string literal** (`tab.container.id === 'internal'`) set at a single
  `createTab` call site. A shared constant or a cross-referencing comment would keep the check and the
  set-site in sync if the container shape changes.
- **`buildSiteInfo` interpolates by string concatenation**, relying on tracker/permission values being
  numbers (safe today). When Flight 6 adds string-type fields to the popup, route everything through
  `escapeHtml` defensively rather than reasoning about types per-field.
- **Witnessed-pattern deviation.** Leg-7 verification was Flight-Director-driven (cdp-driver + node-CDP),
  not the two-agent Executor+Validator crew. Compensating control: every verdict cites a raw machine-read
  value (DOM/computed-style/partition/ARIA/audit exit), which lacks the false-positive recall bias of model
  verdicts. Acceptable for this leg, but Flight 6's verify leg should run the formal Witnessed
  `/behavior-test settings-shell` to restore the adversarial independence the pattern is designed for.

### Documentation
- CLAUDE.md + README were updated (leg 6) and the **Flight-6 origin-check TODO is prominently flagged** —
  good. Two patterns are worth adding to CLAUDE.md's Patterns section before Flight 6: (a) the
  "thin public close-wrapper distinct from the raw `onClose` body" menuController idiom (the close→onClose→
  closeX→close recursion hazard is only in per-call-site comments today); (b) the "retry the
  `wcId`-dependent IPC in the `dom-ready` handler when the panel is open" idiom introduced by the cookies
  race fix.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD2 CSP spike's live-confirm deferred leg 2 → leg 7 | Harness can't launch the GUI; all live verification was batched to leg 7 anyway; strong architectural prior + one-line fallback | Yes — defer live-only spikes to the verify leg with the fallback pre-written, when the harness can't run them |
| Leg-6 (docs) per-leg design review waived → folded into flight-level Reviewer | Docs-only leg has no codebase cross-reference for a design review to add value | Yes — for pure-docs legs |
| HAT fix: Shields "Connection" → "Secure — Goldfinch page" on internal tabs | Flight 5's chip *introduced* the contradiction (chip says secure, Shields said "not secure HTTP") | Yes — keep chrome security surfaces mutually coherent; fix in the flight that introduces the inconsistency |
| HAT fix: `fetchCookies` dom-ready race (Cookies stuck "Loading…") | Pre-existing race made reliably reproducible by the new Settings tab; one-line fix; operator elected fix-in-flight | Borderline — fixing an adjacent, reliably-reproducible regression in-flight is sound when small; otherwise record + defer |
| HAT alignment: semantic green/red address-bar lock | Explicitly within the flight's Adaptation Criteria ("chip glyphs tuned at HAT") | N/A — intended HAT role |
| `role="search"` a11y fix at leg 7 | DD4's baseline assumption was wrong (above) | Lesson, not a practice to standardize |
| Branch `flight/5` stacked on unmerged `flight/4`; draft PR base=`flight/4` | Flight 5 builds on Flight 4's internal scheme, not yet on `main` | Yes — stack + retarget-after-merge for dependent flights |

## Key Learnings
- **Live acceptance is load-bearing for this codebase.** A fully-green offline suite (182/182) coexisted
  with a real new a11y violation and two Shields internal-tab bugs that only the live a11y gate + the HAT
  exposed. The renderer is `nodeIntegration:false` / non-importable, so DOM behavior has *no* offline
  surface — the behavior test + a11y gates are the regression net, not unit tests.
- **A shared interaction controller pays off when it admits non-uniform consumers.** `menuController`
  absorbing a non-menu popup via one guard (`!entry.items`) — rather than a parallel popup system — is the
  win from the DD7 hoist, and the reason the site-info popup cost so little.
- **The HAT surfaces cross-surface incoherence that automated checks won't.** The chip-vs-Shields
  "secure/not-secure" contradiction is invisible to axe and to unit tests; only a human looking at two
  chrome elements at once caught it.
- **Test-metric trend** (seeds future comparison): flight 3 = 147 pass → flight 4 = 161 (+14 url-safety)
  → **flight 5 = 182 (+21 internal-assets)**, ~89 ms wall, lint + typecheck clean, no flakes. The growth is
  entirely pure-helper unit tests authored alongside their modules — the correct shape.

## Recommendations
1. **Flight 6: make the internal-bridge origin-check a HARD prerequisite, not a stretch goal.** Before any
   real Shields/home-page IPC is exposed on `window.goldfinchInternal`, the bridge must refuse privileged
   calls unless `location.origin` is the canonical internal origin. The navigation lock shipped in flight 5
   is UX-only; this check is the actual security boundary.
2. **Scope `HOMEPAGE` promotion explicitly in the Flight 6 design** — persisted store + dual-preload IPC +
   call-site updates + startup load. It is not a one-line "wire the placeholder."
3. **Graduate `menuController` to a unit-testable module and add the mutex/recursion test before the 4th
   consumer** (standing carry-forward from the Flight-3 debrief).
4. **Verify a11y-baseline assumptions against the actual `ACCEPTED` allowlist at design time**, and flag any
   new interactive node added to a previously-unaudited region at the leg design review.
5. **Run the formal Witnessed `/behavior-test settings-shell` in Flight 6's verify leg** to supersede the
   Flight-Director-driven run log, and **author a behavior-test spec covering Shields on an internal tab**
   (Connection = "Secure — Goldfinch page"; Cookies populate, don't hang) so the two HAT-found Shields
   regressions become a standing gate.

## Action Items
- [ ] **Flight 6 (must, first):** add the `location.origin` guard to `internal-preload.js` before exposing
  any real IPC on the bridge.
- [ ] **Flight 6 design:** explicitly scope `HOMEPAGE` → persisted, editable setting (store + dual-preload
  IPC + call-site updates + startup load).
- [ ] **Before the 4th menuController consumer:** extract `menuController` to a module + add a unit test for
  mutex / recursion-avoidance (carry-forward from Flight 3).
- [ ] **Add to CLAUDE.md Patterns:** the thin-close-wrapper-vs-`onClose` recursion idiom and the
  `dom-ready` `wcId`-dependent-IPC retry idiom.
- [ ] **Flight 6 verify leg:** formal Witnessed `/behavior-test settings-shell` run; author + run a
  `shields-internal-tab` behavior-test spec (Connection + Cookies on `goldfinch://settings`).
- [ ] **Small hardening:** add a unit test for `isInternalTab` (null-container / id-match / partition-match)
  and a cross-reference comment linking it to the `createTab` set-site.
- [ ] **PR #30:** retarget base from `flight/4-internal-page-scheme` to `main` after PR #29 merges.
