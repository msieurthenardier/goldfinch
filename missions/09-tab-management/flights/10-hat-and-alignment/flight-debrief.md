# Flight Debrief: HAT & Alignment

**Date**: 2026-07-16
**Flight**: [10-hat-and-alignment](./flight.md)
**Mission**: [First-Class Tab Management](../../mission.md)
**Status**: landed → **completed**
**Commits**: `297b34a` (A1 toggle-align), `589989c` (L1–L4), `790dc81` (L4 overlay rebuild)
**Legs**: 6 (4 built + verified; L4 rebuilt; L5 escalated to F11)

## Outcome Assessment

The HAT did what a HAT is for: the operator drove the real app, and the walk turned "structurally
pinned" into "operator-witnessed" **and** surfaced six concrete alignment gaps that unit tests could never
find. Five were built and verified this flight; the sixth (cross-window drag) turned out to be a whole
flight's worth of work and was escalated to **F11** on a **measured transport GO**. The mission's tab
experience is materially closer to a mainstream browser than when F10 opened.

### Verified live (operator, by-hand)
- **Session restore** (Station A): core restore + **burner exclusion** witnessed on disk for the first
  time; the **2-window menu-Exit** guard (the DD3 two-writer bug) both windows returned; internal-page
  exclusion confirmed by-design.
- **L1** hover highlight + active-tab favicon-kept-when-shrunk. **L2** Ctrl+# re-arm from page focus.
  **L3** sole-tab "Move to window …" moves + closes the source (via menu). **L4** tear-off pill follows the
  cursor over the page (overlay-view rebuild).

### Escalated / carried
- **Cross-window drag → F11.** Station C's HTML5-drag spike measured a **GO** (a custom-MIME `drop`
  crosses `BaseWindow`s intact) — refuting the investigation's own expected NO-GO. Building the gesture is
  flight-sized (static `draggable` kills the pointer reorder; needs a spike + drag-layer rewrite). **F11.**
- **Owed to the operator's clean rig** (the FD deferred the keyed gauntlet after a key-leak, below): the
  real `npm run a11y` verdict; `tab-tearoff` row 8a + the census-only reads; `responsive-tab-strip` Step 5;
  the DD12 re-pointed-spec re-runs; Station F artifact hygiene (28-of-48 stale headers, `getAttachedWindow`
  retirement).

## What Went Well

- **The fix-vs-feature gate worked as designed.** A1's toggle-indent was a one-surface look-and-feel FIX
  (inline, re-verified, committed). The six drag/keyboard/menu takeaways were correctly promoted to scoped
  **design-reviewed** legs, and each review earned its keep — L2 got a simpler main-only `isFocused()` fix
  than proposed; L3's `win.close()` was proven safe (same shape as the window-close IPC); **L5 was caught
  as unbuildable-as-scoped before a line was written** and escalated to its own flight.
- **The Station C spike is the flight's showpiece — and the thesis, paid forward.** The investigation
  reasoned from the Electron API + Chromium architecture and predicted NO-GO at moderate-high confidence; a
  5-minute live probe **refuted it**. F8's second-instrument lesson, in the opposite direction: an
  instrument that reads documentation cannot discriminate the rig's actual runtime — measure on the real
  artifact. It nearly cost a wrongly-retired criterion.
- **The L4 rebuild established a reusable primitive.** The chrome-DOM ghost failed because chrome DOM can't
  paint over the guest's native view; the overlay `WebContentsView` fixes it — and (operator's insight) is
  the seed of a general **chrome-over-guest overlay** capability (window/tab previews on drag; possibly the
  T7 tab-context-menu-clamped-to-content-area constraint). Built on the proven find-overlay pattern with the
  F6/F7 leak guard (sole teardown at `close`) and a deliberate no-focus/`pointer-events:none` divergence.
- **Honest boundaries, stated not hidden.** A3's deleted-jar test was **not end-user-reachable** and the
  operator rightly rejected it; the L4 pill "disappears outside the window" is a real `WebContentsView`
  clipping boundary (subsumed by F11's OS-native drag image), not a bug to chase into the WSLg
  window-positioning fiction.

## What Could Be Improved

### The FD leaked an admin key into the transcript (the flight's real process failure)
Attempting the a11y run, the FD launched `dev:automation` and grepped the log through a `sed` redaction
that matched `key=…` but **not** the actual `{"key":…,"adminKey":…}` JSON — so the minted keys printed in
full. This is the **exact F6 leak class** the standing carry forbids. Contained (process force-killed → keys
invalidated; log removed; nothing committed; blast radius low — dev-minted, local, ephemeral), but it is a
real slip.

> **The rule the F6 carry was missing, now explicit: never print a key-bearing stream at all — a redaction
> that *can miss* is not containment.** Extract a key into an env var inside a single non-printing command,
> or don't touch it and let the operator run the keyed gate. → Recommendation 1; belongs in the mission
> debrief and the methodology.

### A HAT surfaced five build-legs — is "HAT & alignment" one flight or two?
F10 was scoped as a walkthrough; it became a walkthrough **plus** a five-leg implementation flight (with its
own design reviews, a flight-end review, and a rebuild). It worked, but the flight's shape stretched. Worth
asking at the mission level whether a HAT that surfaces substantial build work should spawn a sibling
"alignment build" flight rather than absorb it — the mission debrief should weigh it.

### Verification landed split again
Every takeaway leg's runtime observable (hover paint, the focus re-arm, the actual move+close, the pill
visual) is deferred to the operator's by-hand pass — `main.js`/`renderer.js` remain unexecuted by the unit
suite (the standing gap, now widened by more wiring). The by-hand pass caught the L4 layering bug that the
source-scans structurally could not — vindicating the split, but also underlining how much rides on it.

### Verification
`npm test` **1965 pass / 0 fail / 0 skipped** (F9's 1948 → +5 L1/L2 → +7 L3 → +0 L4 → +5 L4-rebuild). `lint`
+ `typecheck` clean across every leg. `npm run a11y` **not run by the FD** (owed — see the leak); the F9
toggle + F10's CSS were statically a11y-reviewed clean. Flight-end code review of L1–L4 `[HANDOFF:confirmed]`,
no issues; L4-rebuild leak/focus/enumeration spot-checked green.

## Key Learnings

> **1. Never print a key-bearing stream — redaction that can miss is not containment.** (The F6 rule, given
> teeth by an actual F10 slip.)

> **2. A documentation/architecture instrument cannot discriminate the rig's runtime — measure.** The
> Station C probe refuted its own investigation's expected NO-GO. F8's second-instrument lesson, both
> directions: you can wrongly *retire* a capability on an unmeasured premise as easily as wrongly ship one.

> **3. Chrome DOM cannot paint over the guest; an overlay `WebContentsView` can.** The reusable
> chrome-over-guest primitive — the right answer for drag feedback, and a lever for a class of
> "menu/hint clamped to the content area" problems (T7).

## Recommendations

1. **Codify "never print a key-bearing stream" (methodology + the standing carry).** Replace "never echo a
   key" with the operational rule: extract into an env var in one non-printing command, or hand the keyed
   gate to the operator. The FD proved the weaker phrasing is leakable.
2. **The operator runs the owed keyed gauntlet on a clean rig** (a11y verdict; `tab-tearoff` row 8a +
   residual; `responsive-tab-strip` Step 5; the DD12 re-pointed specs). The FD will not self-parse minted
   output after the leak, and the environment was network-degraded anyway.
3. **F11 is the cross-window-drag payoff — spike-first.** Leg 1 measures the two unmeasured premises
   (`draggable`-set-at-`pointerdown` timing; drop delivery over the `-webkit-app-region: drag` strip);
   payload must be `{wcId,url,title,favicon,container}`; rule on the drop-side authority (source from a
   payload `wcId` is a real weakening). The L5 spec's analysis carries as F11's design input.
4. **Treat `tearoff-overlay-manager` as the seed of a general chrome-over-guest overlay** — and investigate
   T7 (tab context menu clamped to the content area) against it.

## Action Items

- [ ] **Operator, clean rig:** the owed keyed gauntlet (Rec 2). Any failure → a follow-up commit.
- [ ] **F11 — cross-window tab drag** on the measured HTML5-DnD GO (Rec 3). Spike-first.
- [ ] **T7 (recorded):** tab context menu clamped to the content area — investigate against the overlay-view
      primitive (mission debrief / a future flight).
- [ ] **Mission-debrief carries:** the key-print rule (Rec 1); the measure-don't-reason lesson (#2); the
      chrome-over-guest overlay primitive (#3); the HAT-that-became-a-build-flight shape question; the A3
      tabless-window deferred edge (F9) still open.
