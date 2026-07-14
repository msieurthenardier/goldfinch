# Flight Log: Keyboard Tab Navigation Parity

**Flight**: [Keyboard Tab Navigation Parity](flight.md)

## Summary

Leg 1 (`cycle-and-jump`) implemented and landed: the classifier/dispatch/guest-
forwarding/sheet-mapper extension for tab cycling and position jumps, unit
pins, live capture-point checks, and the `tab-cycling` behavior spec authored
(draft). Leg 2 (`verify-and-docs`) remains.

---

## Leg Progress

### Leg 2 — `verify-and-docs`

**Status**: landed
**Dates**: 2026-07-14

- `/behavior-test tab-cycling` — **PASS 11/11 on the spec's first run**
  (`tests/behavior/tab-cycling/runs/2026-07-14-19-47-08.md`, live Witnessed
  mode, fresh crew). All three capture points verified live; visual-order
  resolution proven on jump AND cycle paths; wrap both directions;
  out-of-range positive control; address-replace semantics; internal-guest
  non-trapping; single-tab degenerate case. Accepted apparatus deviations
  recorded in the run log (WSLg hasFocus; internal-session evaluate refusal;
  Ctrl+Tab standing in for PgDn/PgUp per the KEY_MAP gap).
- DD5 CLAUDE.md doc pass landed (single new Patterns subsection "Tab strip:
  structure, order authority, keyboard navigation (M09 Flights 1–3)" — all
  five topics, line anchors verified against the working tree; only
  CLAUDE.md touched).
- `npm run a11y` WCAG gate: "No NEW violations" ✅. `npm test` 1604/1604;
  lint, typecheck clean.
- Run-log follow-ups routed: KEY_MAP PageDown/PageUp gap (maintenance
  candidate); spec polish (Step 8 neutral-tab activation; Step 10 mid-order
  variant); early-run validator evidence-location correction (orchestrator
  removed stray in-repo files; protocol reminder recorded).

---

### Fix cycle — review feedback (post-Leg-2, FD-ruled)

**Status**: landed
**Dates**: 2026-07-14

Three FD-ruled review findings addressed on the same branch (no new leg):

- **[Medium] README gap.** The "Keyboard shortcuts" table never got the M09 F3
  chords added: `Ctrl+Tab`/`Ctrl+Shift+Tab` and `Ctrl+PgDn`/`Ctrl+PgUp`
  (cycle next/previous, wraps), `Ctrl+1`–`Ctrl+8` (jump to tab N), `Ctrl+9`
  (jump to last tab). While auditing the table's scope, the Flight 2
  strip-scoped `Ctrl+Shift+←`/`Ctrl+Shift+→` (move the focused tab) turned out
  to be missing too — added alongside, since the table's existing `←`/`→` row
  already covers strip-scoped tab-focus shortcuts. Docs-only change.
- **[Medium] Stale comment.** `src/main/main.js`'s internal-guest
  `before-input-event` wiring still described the INTERNAL forwarding
  allowlist as "new-tab + close-tab only" — stale since Leg 1 added the
  tab-cycle/jump set to `INTERNAL_CHROME_ACTIONS` too (per DD1/DD2: an
  internal settings page must not trap the operator). Comment rewritten to
  name the forwarded tab-cycle/jump set explicitly and to scope the
  "deliberately thin" principle to future *privileged* actions, not the
  navigation-neutral set already landed.
- **[Low, FD-ruled fix] Auto-repeat divergence under guest focus.**
  `handleGuestChromeShortcut`'s blanket `!input.isAutoRepeat` guard (added to
  stop a held key from stacking new-tab/downloads-style actions) was also
  silently suppressing repeat-cycling for `tab-next`/`tab-prev`/`tab-jump-*`
  whenever a WEB or INTERNAL guest held OS focus — contradicting the leg's
  Edge Cases ruling ("allow repeat cycling," Chrome parity), which the
  chrome-focus dispatch path already honors (no guard there). Fixed with a
  targeted exemption: a new pure predicate `isRepeatSafeAction(action)`
  (`src/shared/guest-forward-allowlist.js`) returns true for the whole
  `tab-*` family — `tab-next`/`tab-prev` need the exemption for correctness;
  the jumps are idempotent under repeat, so folding them into the same
  `tab-*` prefix check is harmless and simpler than special-casing just the
  two cycle actions. `handleGuestChromeShortcut` now forwards when
  `isRepeatSafeAction(action) || !input.isAutoRepeat`. The guard logic itself
  lives in `main.js` (not unit-reachable — no unit test loads `main.js`,
  which requires `electron`), but the carve-out *decision* is a pure,
  exported predicate, so it got a full unit pin (every `tab-*` action true,
  every other forwardable action false, non-string/null/undefined/empty
  never throws) in `test/unit/guest-forward-allowlist.test.js`. No new test
  scaffolding was built for the main.js-side wiring itself, per the review
  instruction.

**Verification:** `npm test -- --test-timeout=30000` — 1622/1622 green (up
from 1604 pre-fix: +18 new `isRepeatSafeAction` pins). `npm run lint` and
`npm run typecheck` — both clean. No behavior-spec re-run (no product
behavior changed for the already-passing `tab-cycling` spec's covered
paths; the repeat-cycling fix affects guest-focus repeat, which the spec
doesn't drive live — see Leg 1's Decisions note on that gap).

---



### Leg 1 — `cycle-and-jump` (landed)

**Changes:**
- `src/shared/keydown-action.js` — `keydownToAction` gains an `alt` parameter
  (default `false`) and new mappings: `Ctrl+Tab`→`tab-next`,
  `Ctrl+Shift+Tab`→`tab-prev`, `Ctrl+PageDown`→`tab-next`,
  `Ctrl+PageUp`→`tab-prev`, `Ctrl+1..8`→`tab-jump-1..8`, `Ctrl+9`→
  `tab-jump-last`. Digits gated on `!alt` (AltGr guard) but NOT on `shift`
  (AZERTY parity); none of the new mappings are lightbox-deferred.
- `src/renderer/renderer.js` — `dispatchChromeAction` gains the
  `tab-next`/`tab-prev`/`tab-jump-*` cases (over `orderedTabIds()` +
  `activateTab`, ~30 lines); the chrome keydown listener now passes
  `alt: e.altKey` into `keydownToAction`.
- `src/main/main.js` — `handleGuestChromeShortcut` passes `alt: input.alt`
  into `keydownToAction`; the sheet's `before-input-event` handler passes
  `alt: input.alt` into `sheetAcceleratorAction`.
- `src/shared/guest-forward-allowlist.js` — both `WEB_CHROME_ACTIONS` and
  `INTERNAL_CHROME_ACTIONS` gain the full tab-cycle/jump action set (per the
  leg's explicit ruling: tab switching must not trap the operator on an
  internal tab, unlike the rest of the conservative internal allowlist).
- `src/shared/sheet-accelerator.js` — `sheetAcceleratorAction` gains an `alt`
  parameter and the same chrome-class tab-cycle/jump mappings, in lockstep
  with the classifier (documented hand-mirror risk carried forward).
- `test/unit/keydown-action.test.js`, `test/unit/guest-forward-allowlist.test.js` —
  new pins for every new mapping, the AltGr guard (`Ctrl+Alt+7`/`Ctrl+Alt+9`
  → `null`), the shifted-digit case, and per-guest-kind forwarding.
- `test/unit/sheet-accelerator.test.js` — new union pins; the existing
  generic loop test's `'Tab'` entry **removed** in this same change (it is no
  longer a non-union key) per the flight's DD4 note — landed alongside the
  new tests, not as a follow-up.
- `tests/behavior/tab-cycling.md` — authored (Status: `draft`, Last Run:
  `never`), following `tab-reorder.md`'s house style.

**Verification:**
- `node --test test/unit/keydown-action.test.js test/unit/guest-forward-allowlist.test.js test/unit/sheet-accelerator.test.js` —
  126/126 green.
- `npm test -- --test-timeout=30000` — full suite, 1604/1604 green.
- `npm run lint` — clean. `npm run typecheck` — clean.
- **Live capture-point checks** (`dev:automation` + admin MCP, six tab-strip
  fixture pages + the boot default tab, port free-fell to 49709 since no pin
  was set): all five required checks passed —
  - **Chrome-focus cycling + address-replace:** focused the address bar,
    typed an unsubmitted in-progress edit, `Ctrl+Tab` cycled (wrapped
    last→first) and the address value became the new tab's real URL,
    **not** the in-progress text — confirms the replace-not-keep semantics
    (DD open question).
  - **Guest-delivered cycling:** `Ctrl+Tab` sent directly to a background
    web guest's wcId cycled the active tab to its DOM-successor — the
    guest-forwarder capture point works.
  - **Internal-tab cycle:** opened `goldfinch://settings` (via
    `kebabActionSettings()`), delivered `Ctrl+Tab` to its wcId — cycling
    still worked (wrapped to the first tab) — an internal tab does not trap
    the operator.
  - **Jump after reorder follows visual order:** reordered the
    DOM-position-2 tab one slot right via the existing `Ctrl+Shift+ArrowRight`
    chord, then `Ctrl+3` activated the tab that moved INTO position 3 (not
    the pre-reorder occupant) — jumps resolve against `orderedTabIds()`.
  - **Sheet-open cycle:** opened the kebab menu, delivered `Ctrl+Tab` to the
    probed sheet wcId — the menu closed (confirmed via DOM `.hidden` class
    and a `captureWindow()` screenshot) **and** the active tab cycled to the
    next tab in one keypress, via the existing `tab-switch` close reason (no
    new plumbing).
  - Also spot-checked: out-of-range jump (`Ctrl+7` with 6 tabs open) is a
    true no-op (before/after state byte-identical); `Ctrl+9` (`tab-jump-last`)
    correctly resolves to the actual last tab.

**Decisions/deviations/anomalies:** see below.

---

## Decisions

- Leg 1: `INTERNAL_CHROME_ACTIONS` gains the FULL tab-cycle/jump set (not
  extended "one action at a time" like the rest of the conservative internal
  allowlist) — an explicit, narrow exception per the leg spec's own ruling,
  called out in the allowlist source comment so a future reader doesn't
  mistake it for scope creep.
- Leg 1: no `isAutoRepeat` guard was added to the new cycle/jump actions
  (matches the leg's Edge Cases ruling — Chrome allows held-key repeat
  cycling). Not re-verified live (an automated held-key repeat isn't
  reachable over `pressKey`'s discrete-press model); left as a HAT item if
  ever needed.

---

## Deviations

- Leg 1: the authored `tab-cycling.md` spec's Step 5 originally called for
  live `Ctrl+PageDown`/`Ctrl+PageUp` delivery via `pressKey`. The live checks
  surfaced a genuine automation-surface gap (see Anomalies) — the step was
  rewritten to use `Ctrl+Tab` as a stand-in for the scroll-suppression
  assertion, with the gap documented in the spec's own Out of Scope section
  rather than silently worked around.

---

## Anomalies

- **Automation-surface gap: `pressKey` cannot send `PageDown`/`PageUp`.**
  `src/main/automation/input.js`'s `KEY_MAP` (consulted by the `pressKey` MCP
  tool) has no entry for `PageDown`/`PageUp` — `pressKey(wcId, 'PageDown',
  ['control'])` throws `automation: unknown key PageDown`. This is a gap in
  the automation tooling, not a product defect: `keydownToAction` and
  `sheetAcceleratorAction` both map `PageDown`/`PageUp` to the identical
  `tab-next`/`tab-prev` action strings as `Tab`/`Shift+Tab` (pinned by the
  unit suite), and `dispatchChromeAction` dispatches on the action string
  alone, so the live check substituted `Ctrl+Tab` (see Deviations). Extending
  `KEY_MAP` (+ the `mcp-tools.js` description string) to add `PageDown`/
  `PageUp` is a small, self-contained automation-surface follow-up — outside
  this flight's Files Affected list; noted here so it isn't lost before the
  mission's routine-maintenance pass.

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight `ready` → `in-flight`; branch
  `flight/3-keyboard-tab-navigation` stacked on `flight/2-tab-reorder`
  (PRs #84/#85 await operator merges).
- Leg 1 `cycle-and-jump` designed. **Risk tier: LOW** — although it extends
  the shared classifier (three consumers), the flight-level Architect review
  already performed a line-level audit of every touched file (alt/AltGr
  ruling, the sheet-test loop pin, cross-view-nav branch-order verification
  in code) and its rulings are embedded verbatim in the leg. A per-leg
  review would re-walk the same ground; the flight-end Reviewer covers the
  code.
