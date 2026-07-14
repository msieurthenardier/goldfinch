# Flight Log: Shrink-to-Fit Tab Strip

**Flight**: [Shrink-to-Fit Tab Strip](flight.md)

## Summary

Leg 1 (`progressive-shrink-and-middle-click`) landed 2026-07-14: CSS
container-query staged shrink, no scrollbar/no-clip at any tab count,
middle-click close, and the evolved `responsive-tab-strip` behavior spec.
Leg 2 (`verify-integration`) landed 2026-07-14 after one fix cycle: run 1
(8 pass / 1 fail / 1 inconclusive) caught the sliver-stage active-close
clip → fixed per the DD2 amendment (64px active-tab-only floor + paired
favicon-hide); run 2 passed **10/10** (fix verified by rect containment +
independent pixel inspection; Step 9 resolved to a primary-regime pass on
outer-geometry evidence). a11y WCAG gate green (no new findings);
`npm test`/lint/typecheck green; `tab-keyboard-operability` audited — no
spec change needed (ARIA-semantic assertions are DOM-depth-agnostic).

---

## Leg Progress

### Leg 1: `progressive-shrink-and-middle-click`

- **Status**: landed
- **Started**: 2026-07-14
- **Completed**: 2026-07-14

**Changes Made**

- `src/renderer/styles.css` — `#tabs` `overflow-x: auto` → `overflow: hidden`,
  dead `scrollbar-width: thin` removed, stale scroll-wording comments rewritten
  on `#tabs`/`#tabstrip-drag`. `.tab` lost its `min-width: 88px` floor and
  gained `container-type: inline-size`. **Deviation from the leg's literal
  guidance**: the padding-compress stage could not land as
  `@container (max-width: 40px) { .tab { padding: … } }` as suggested — see
  Anomalies below — so the flex row + padding that used to live directly on
  `.tab` was moved into a new inner `.tab-row` wrapper, with `.tab` kept as
  the pure sizing/query-container box (flex-basis, `overflow: hidden`,
  `container-type`). All three staged `@container` rules now key off literal
  rendered (border-box) px, since `.tab` itself carries no padding: title
  hides at `<=72px`, the close button hides on inactive tabs at `<=56px`
  (`.tab:not(.active) .tab-close`, so the active tab's close is never
  touched), and `.tab-row`'s padding/gap compress at `<=40px`.
- `src/renderer/renderer.js` — `createTab`'s `btn.innerHTML` now wraps the
  tab's visible content (jar dot, favicon, title, close button) in
  `<span class="tab-row">…</span>` to give the padding-compress stage a
  legal target (see above). Added an `auxclick` handler next to the existing
  `click` handler: filters to `e.button === 1` (middle), calls
  `preventDefault()`, and mirrors the ✕ path exactly
  (`freezeTabWidths()` when `tabs.size > 1`, then `closeTab(id)`).
- `tests/behavior/responsive-tab-strip.md` — evolved per flight DD4/DD5:
  admin-tier `evaluate(chromeWcId, …)` numeric reads (`#tabs.scrollWidth`
  vs `clientWidth`, per-tab `getBoundingClientRect().width`, `.tab-close`
  `getComputedStyle().display`) promoted to the primary layout observable;
  `captureWindow()` demoted to rendered-truth/WSLg-distortion fallback and
  coordinate-click backup. Old Step 4 (scroll-onset) replaced with a
  pathological-count (60+) no-scroll/no-clip numeric assertion. Added a
  fixture-distinctness precondition/step (folds in the Flight-2 HAT-deferred
  probe) and a middle-click close step (trusted `button: 'middle'`,
  matching the ✕ deferred-reflow signature). Total steps 8 → 10
  (fixture-distinctness + middle-click added); `Last Run` field left as-is
  for the `verify-integration` leg to update.
- `BACKLOG.md` — "Tab strip: Chrome-style shrink, no scrollbar" entry body
  replaced with a one-line "landed in M09 Flight 1 Leg 1" pointer (no
  existing retirement precedent in this file to match; this is the first
  entry to reach done).

**Verification**

- `grep -n "overflow" src/renderer/styles.css` — `#tabs` shows `overflow: hidden`,
  no `overflow-x: auto`. `grep -n "min-width" …` — no `.tab` floor (only
  `#tabstrip-drag`'s unrelated `min-width: 56px` remains).
  `grep -n "scrollbar-width" …` — 0 hits.
- `grep -n "container-type\|@container" src/renderer/styles.css` — container
  established on `.tab`; three staged `@container` rules present; the
  active-tab close carve-out is the `:not(.active)` scoping (verified live,
  see below — active tab's close never hides at any width).
- `grep -n "auxclick" src/renderer/renderer.js` — handler present, `e.button`
  filter + `preventDefault()`.
- `npm test` (1527 assertions, `--test-timeout=30000`), `npm run lint`,
  `npm run typecheck` — all green, run twice (before and after the
  `.tab-row` fix below).
- **Live render spot-check** (dev launch: `GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`, MCP SDK client on
  `127.0.0.1:<bound-port>/mcp` with the admin Bearer key, `getChromeTarget`
  for the chrome `wcId`, `evaluate`-driven `createTab()` loops to open tabs,
  `captureWindow` screenshots). Confirmed numerically and visually at three
  tab counts (screenshots under
  `/tmp/behavior-tests/goldfinch/flight1-spotcheck/`, not committed —
  local-only per this project's snapshot convention):
  - **1 tab** (`baseline-1-tab.png`): 240px, comfortable, unchanged from
    before this leg.
  - **~15 tabs** (`at-15-tabs.png`): all tabs ~72px, title hidden on all,
    close **visible on all** (comfortable-padding stage, before the
    close-hide threshold) — `#tabs.scrollWidth === clientWidth` (no
    overflow).
  - **~65 tabs** (`at-60-tabs.png`): all tabs ~13px (sliver stage, padding
    compressed to 4px), title hidden on all, close visible **only on the
    active tab** (`closeVisibleCount: 1`), jar dot still visible, active-tab
    gold inset top-bar cue still visible (`box-shadow` present), zero tabs
    at width `<= 0`, and `#tabs.scrollWidth === clientWidth` exactly (no
    scrollbar, no clipped tab) even pushed to 71 tabs in one probe run.
  - Middle-click verified live: `click(wcId, x, y, { button: 'middle' })`
    on a tab body closed it (tab count 4 → 3), confirming the `auxclick`
    handler fires and routes through the same close path as ✕.
  - Dev app killed after verification.

---

### Leg 2: `verify-integration`

- **Status**: landed
- **Started**: 2026-07-14
- **Completed**: 2026-07-14

Run `tests/behavior/responsive-tab-strip/runs/2026-07-14-14-44-17.md`:
**8 pass / 1 fail / 1 inconclusive** (first run of the evolved spec, live
two-agent Witnessed mode).

- **FAIL — Step 5 (sliver-stage active close clipped).** At 62 tabs
  (~14.33px slivers) the active tab's `.tab-close` reads
  `display:block/visible` in the DOM but its 16px box lands ~19px outside
  its own tab and is never painted (magnified screenshot crops are
  unambiguous). The rendered truth contradicts the flight's "active tab
  keeps its close affordance at every stage" guarantee. Leg 1's spot-check
  missed this because it verified `closeVisibleCount` via computed
  `display` — the DOM-read trap CLAUDE.md's native-surface section warns
  about, caught here by the spec's DD4 screenshot-authoritative rule.
- **INCONCLUSIVE — Step 9 (WSLg maximize caveat).** DD7 read path flipped
  correctly on both clicks (4 channels in lockstep); compositor geometry
  lagged >1s and ended desynced (2560x1392 while `data-state="normal"`).
  Needs-human-recheck on a native compositor → routed to the mission HAT
  flight. If it reproduces off-WSLg it's a real DD7 bug.
- **Advisories recorded** (triage, not this flight's scope): forward Tab
  order from the address bar never reaches the tablist (walks into
  media-panel controls of a non-open panel; shortest keyboard route to the
  strip is Shift+Tab through the window controls) — flag adjacent to
  `tab-keyboard-operability`; the `+` pill slides left immediately on
  pointer-close because `#tabs` shrink-wraps (freeze protects tab close
  targets, not the pill); behavior-test fixtures need `<meta charset>`.

**Fix cycle (this leg, per the DD2 amendment below):**

- **`src/renderer/styles.css` — active-tab width floor + paired content
  reduction.** `.tab.active` gains `min-width: 64px` (the only tab-width
  floor anywhere in the strip; every other tab keeps the original no-floor
  shrink). Paired with it, a new rule scoped to `.tab.active .tab-fav`
  hides the active tab's favicon at the same `@container (max-width: 72px)`
  threshold the title-hide stage already uses (title is already hidden on
  the active tab once floored, since 64 <= 72). Content budget at the
  64px floor: padding 20px (2x10px, not yet compressed — 64 > the 40px
  padding-compress threshold) + jar dot 8px + one gap 8px + close button
  16px = 52px, leaving 12px of slack. 64px sits in the amendment's
  suggested 64–80px range; chosen at the low end since the paired
  favicon-hide already frees enough room, and a smaller floor minimizes
  what the other tabs have to absorb at pathological counts. The
  `@container` condition is a descendant selector (`.tab.active .tab-fav`),
  not a bare `.tab` self-target — the leg-1 anomaly (a container can't
  restyle itself) does not apply here since the condition is evaluated
  against `.tab`'s own resolved width regardless of which selector it
  gates.
- **Why this doesn't reintroduce the barred global floor:** only the
  active tab (exactly one at a time) carries `min-width`; every inactive
  tab is still `min-width: 0` (auto, via `overflow: hidden`) and free to
  shrink to sub-pixel slivers as before. `freezeTabWidths` (renderer.js)
  reads each tab's *live rendered* `getBoundingClientRect().width` into
  an inline `flex: 0 0 <w>`, so a frozen active tab is already frozen at
  its post-floor width — no separate interaction/clamping-order bug to
  guard against.

**Live verification of the fix** (targeted check, not the full spec
re-run — that still gates landing): killed the stray running dev
instance, relaunched `GOLDFINCH_AUTOMATION_DEV_MINT=1
GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation` with no port pin
(free-fallback bound the next free port after the prior port lingered in
TIME_WAIT), admin SDK MCP client, `getChromeTarget`, then an
`evaluate`-driven `createTab()` loop (batches of 10 against the existing
local fixture server) up to 64 tabs. Numeric read at 64 tabs: active
tab rect `{ left: 1075, right: 1139, width: 64 }`, its `.tab-close` rect
`{ left: 1101, right: 1117, width: 16 }` — fully contained in the active
tab's rect on all four edges; `.tab-close` `getComputedStyle().display`
`"block"`; active tab's `.tab-fav` `display: "none"` (the paired content
reduction engaged as designed); `#tabs.scrollWidth === clientWidth`
(1132 = 1132, no overflow); every tab width `> 0` (min 12.94px, max
64px — the active tab's floor); tab count preserved at 64. A
`captureWindow()` screenshot magnified 6x on the strip's right end
visually confirms an actual rendered ✕ glyph inside the active (gold-topped,
widest) tab, while the neighboring inactive slivers correctly show no
close glyph (their own close-hide stage). Evidence (not committed, local
regression artifact per this project's snapshot convention) saved under
`/tmp/behavior-tests/goldfinch/flight1-fix-check/` (outside the repo):
`geometry.json`, `verdict.json` (`overallPass: true`), `full-window.png`,
a magnified crop, and the app stdout log. App killed after verification;
the fixture server was left running throughout, untouched.

`npm test` (1527 assertions), `npm run lint`, `npm run typecheck` — all
green after the CSS change.

**Spec touch-ups applied to `tests/behavior/responsive-tab-strip.md`**
(from this run's validated learnings, ahead of the full re-run):
Step 5's Expected Results gained the rect-containment + rendered-✕
assertion for the active tab (explicitly permitting it to be wider than
the inactive slivers — the amendment working as designed), with the DOM
`display` read demoted to supplementary corroboration; Steps 6/7's
"clientWidth is unchanged" clause was reworded to the semantic contract
(`#tabs` shrink-wraps, so `scrollWidth === clientWidth` throughout —
assert frozen per-tab widths and where the freed space opens instead);
the port precondition was softened from a hard `GOLDFINCH_MCP_PORT=49707`
pin to pin-if-free/else free-fallback-and-read-the-bound-port; a fixture
`<meta charset="utf-8">` note was added; and the `#window-controls`-is-
inside-`#tabstrip` apparatus fact (window-control clicks don't end the
freeze via `mouseleave`) was codified in Preconditions. A stale
cross-reference (the focus-anchor precondition pointed at "Step 9" for
the keyboard-close sequence, which is Step 10 in the current numbering)
was also corrected while in the area.

**Full re-run (run 2) — PASS 10/10, leg lands.** Run
`tests/behavior/responsive-tab-strip/runs/2026-07-14-15-47-10.md` (fresh
Executor/Validator agents per re-run policy, cache-cold, app on the
free-fallback port per the softened precondition):

- **Step 5 (the previously failed checkpoint): PASS** — at 62 tabs the
  active close rect is fully inside the active tab rect (all four edges,
  re-derived by the Validator from raw numbers) and a painted ✕ is visible
  in the 8x magnified crop; inactive slivers at 13.5px, no scroll, no clip.
  The DD2-amendment floor is observable working (active 64px vs slivers).
- **Step 9: PASS under the primary regime** (run 1 was inconclusive) — the
  DD7 read path flipped cleanly both directions AND outer window geometry
  corroborated both real transitions (2560x1392 maximized / 1432x942
  restored). Residual WSLg artifact: renderer inner-viewport lag/desync —
  environment, not app; the native-hardware manual maximize/restore
  spot-check stays on the mission HAT list.
- Steps 6–8 verified the reworded semantic gap contract precisely
  (byte-identical frozen widths, slide-into-slot at the unmoved coordinate,
  shrink-wrapped `#tabs`, middle-click identical to ✕); Step 10 confirmed
  immediate keyboard reflow (<0.5s).
- Apparatus learnings recorded in the run log: `pressKey` wants `ShiftTab`;
  the backward focus walk passes focus through the window controls
  (focus-only hazard for future keyboard specs); fixture HTTP caching keeps
  stale titles after an on-disk fixture fix.

**Remaining leg ACs closed on the final tree**: `npm run a11y`
(`--tags=wcag2a,wcag2aa,wcag21a,wcag21aa`) — "No NEW violations — every
violation node is in the ACCEPTED baseline"; `npm test` (1527 assertions) /
`npm run lint` / `npm run typecheck` all green; `tab-keyboard-operability.md`
audited against the `.tab-row` DOM — its assertions are ARIA-semantic
(roles, accessible names, `aria-keyshortcuts`) and depth-agnostic, and it
runs at low tab counts where every close is visible: **no spec change
needed**.

## Decisions

- **`.tab-row` inner wrapper (Leg 1, mid-implementation)**: introduced a new
  `<span class="tab-row">` wrapping the tab's visible content so the
  padding-compress `@container` stage has a legal (descendant) target — see
  Anomalies. `.tab` itself keeps the sizing/query-container properties
  (`flex`, `width`/`max-width`, `overflow: hidden`, `container-type`);
  `.tab-row` carries `display: flex`, `align-items`, `gap`, and `padding`.
  No existing code depended on `.tab`'s children being direct children
  (all lookups are `querySelector('.tab-close')` etc., class-based and
  depth-agnostic), so this was a safe, additive DOM change.

---

- **DD2 amendment (FD ruling, post-run): active-tab-only close
  accommodation.** DD2's "no hard floor" stands for tabs in general (the
  no-scrollbar/no-clip invariant is untouched), but the active tab may hold
  a width floor (and/or stage its own content reduction) sufficient to
  render its close button fully inside its bounds at every count. Scope
  check: the window's 900px minimum width makes a single ~64–76px floored
  tab incapable of forcing overflow at any realistic count (the gap-derived
  physical bound, ~4px/tab, dominates long before). The flight spec's
  "acceptable variations" barred a *global* floor as a divert trigger; this
  amendment is narrower than that bar and is recorded here rather than by
  rewriting the flight spec (original framing preserved as commentary).
- **Fix cycle (leg 2, within its "failed step is investigated and fixed
  before the leg lands" AC):** (1) code fix per the amendment — contract:
  at every width the active tab renders a hit-testable ✕ fully inside its
  bounds, verified by rect containment AND pixels; (2) spec touch-ups from
  the run: Step 5 gains the rect-containment + rendered-✕ assertion for the
  active tab, Steps 6/7 "clientWidth unchanged" reworded semantically
  (shrink-wrapped `#tabs`), preconditions port-pin softened to
  "pin-if-free, else free-fallback + read the bound port", fixture-charset
  note, window-controls-inside-strip fact codified; (3) FULL spec re-run.

## Deviations

- **Padding-compress stage does not target `.tab` directly, contrary to the
  leg's Implementation Guidance suggestion** (`@container (max-width: 40px)
  { .tab { padding: 7px 4px; gap: 4px; } }`). Reason: a CSS container query
  cannot restyle the element that establishes the container itself — this
  is a genuine CSS behavior (confirmed live: a trivially-true `@container`
  rule targeting `.tab` with an always-true condition never took effect,
  while the identical rule targeting a `.tab` descendant did apply). See
  the Anomaly below for how this was discovered and its real-world impact
  before the fix. Resolved via the `.tab-row` wrapper (Decisions above);
  the three disclosure stages behave exactly as specified in the acceptance
  criteria, just implemented with an extra wrapper element.

---

## Anomalies

- **CSS container queries cannot restyle their own query container — caused
  a real no-scrollbar/no-clip violation, caught and fixed before landing.**
  During the live render spot-check, the first implementation (padding
  rule written directly on `.tab`, per the leg's suggested starting point)
  showed `#tabs.scrollWidth` (1460px) exceeding `clientWidth` (1132px) at
  61 tabs — i.e. real, silent content clipping via `overflow: hidden`,
  violating the flight's core "no scrollbar / no clip at any count"
  invariant (DD2). Root-caused via live `evaluate` probes: (1) forcing
  explicit widths on a single tab and reading computed `display` showed the
  title/close-hide stages (which target `.tab` *descendants*,
  `.tab .tab-title` and `.tab:not(.active) .tab-close`) engaged at the
  documented thresholds, but the padding-compress stage (targeting `.tab`
  itself) never engaged — `getComputedStyle(tab).paddingLeft` stayed
  `10px` at every width tested, including a synthetic width forced far
  below the 40px threshold; (2) a targeted probe injecting a trivially-true
  `@container (max-width: 400px) { .tab { outline: 3px solid red; } }`
  confirmed the outline never applied to `.tab` itself while the identical
  rule against a `.tab` descendant (`.tab .tab-fav`) did apply — isolating
  the cause to the query-container-can't-style-itself limitation rather
  than a threshold-tuning error. With padding pinned at a permanent 20px
  (10px each side) floor, 61 tabs × 20px + 60 gaps × 4px (1460px) exceeded
  the 1132px available strip width — real overflow, invisibly clipped by
  `overflow: hidden` (not a scrollbar, but tabs genuinely missing from the
  render). Fixed via the `.tab-row` wrapper (Decisions/Deviations above);
  re-verified live at ~65–71 tabs with `scrollWidth === clientWidth` exactly
  and zero tabs at width `<= 0`. This was **not** the DD1 "`@container`
  display-flip misrender" premise failure the leg's STOP condition
  describes (DOM and rendered pixels agreed at every step — the rule
  simply never matched, consistently) — no `[BLOCKED:container-query-premise]`
  was warranted; this was a fixable implementation-scoping issue, not a
  premise failure of CSS container queries as a mechanism. Recording here
  because it's a reusable lesson: **a container query's descendant
  selectors (`.tab .child`) apply as expected; a selector matching the
  container element itself (bare `.tab`) inside its own `@container` block
  silently never matches, with no error or warning.**
- A rapid `evaluate`-driven loop opening 46 tabs in one call intermittently
  returned a generic `"Script failed to execute"` MCP error once during
  spot-checking (likely transient — the default homepage is `google.com`,
  and opening dozens of tabs against it in quick succession triggered
  Google's bot-detection/reCAPTCHA interstitial repeatedly, generating
  heavy console/network noise in the renderer). Retrying in smaller
  batches (10 at a time) succeeded every time with no code changes needed;
  not treated as a product defect — recorded in case the
  `verify-integration` leg's behavior-test run hits the same flakiness
  opening many tabs against a live network homepage (a local fixture,
  already required by the spec's preconditions, avoids this entirely).

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight moved `ready` → `in-flight`; branch
  `flight/1-shrink-to-fit-strip` created from `main` (`02f7358`).
- Leg 1 `progressive-shrink-and-middle-click` designed. **Risk tier: LOW** —
  additive, single-surface chrome CSS + a ~6-line renderer handler, all
  within established patterns; the one contract change (behavior-spec Step 4
  replacement) was adjudicated at flight design review (Architect,
  approve-with-changes, ruling recorded in flight DD2). Per-leg design review
  skipped; flight-end Reviewer covers the code.
- Apparatus fact verified in code before leg lock: MCP `click` forwards
  `button: 'middle'` (mcp-server.js click case; engine `mouseClickEvents`
  takes `{ button }`) — the evolved spec can drive middle-click as trusted
  input.
