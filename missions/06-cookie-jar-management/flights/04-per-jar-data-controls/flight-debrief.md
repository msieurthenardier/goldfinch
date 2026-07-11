# Flight Debrief: Per-Jar Data Controls

**Date**: 2026-07-10
**Flight**: [Per-Jar Data Controls](flight.md)
**Status**: landed
**Duration**: 2026-07-10 (design) – 2026-07-10 (landed; HAT resumed post-crash same day)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved

Everything the flight charted, plus HAT-driven polish beyond charter. Per-jar data
controls shipped end to end: the `jar-data-classes.js` taxonomy (DD2), twin-registered
`jars-clear-data`/`jars-wipe` IPC with strict fail-closed guards (DD3), the
`jar-wiped` broadcast + chrome reload sweep (DD4), the settings-style master-detail
relayout with instant-apply editing under the uniform focus rule (DD1/DD6), the
confirm-everything data-controls UI with shared swap-confirm area (DD5), the
read-only Burner section (DD7), and the self-deriving broadcast-invariant net (DD8) —
which caught a real pre-existing bug (`automation:set-port` not broadcasting) before
its own first run. All five checkpoints met; neither Divert criterion triggered.

### Mission Criteria Advanced

The mission's data-control criterion (clear cookies / site storage / cache, full
identity wipe per jar) is now live and behavior-tested. The HAT additionally closed
both Flight 3 carry-forward zero-witness paths (`reconcileUi` cross-surface race;
create/confirm Escape paths) with live witnesses.

### Value Delivered

- Machine gates: suite 1242 → **1277** (+35), typecheck/lint clean throughout.
- Behavior tests: `jar-data-controls` **7/7 first run** on a fresh stage;
  `jar-delete-closes-tabs` **5/5** regression re-run. The new spec closed two
  Flight 3 Validator carry-forwards (real burner cookie cross-check; in-memory
  reload sentinel).
- HAT: 7/7 steps passed; findings F1–F7 all fixed inline and operator-re-verified.
- Two pre-existing bugs found and fixed beyond charter: settings-page
  `jars-changed` staleness (F6, two instances — key list and activity-viewer
  labels) and unguarded `jar.color` rendering on the settings page (F7 rider:
  `safe-color.js` was never even loaded there).

## What Went Well

- **Design review caught defects before code, three for three.** Leg 2's review
  found the draft's scroll-container direction inverted (would have shipped an axe
  violation the donor file documents against) and a false "create-panel focus
  survival" premise (the property didn't exist — promoted to a REQUIRED AC and
  built). Leg 3's review found the delete-confirm mechanism doesn't generalize to
  five sibling actions — redesigned at review time (transition keyed on
  `action:rowId`, not a boolean), not mid-implementation.
- **The HAT-script design review found a real bug before the operator spent a
  minute**: `commitOrRevertName` had no dirty tracking, so a non-dirty blur after a
  cross-page rename committed the stale name back. Fixed pre-HAT; step 6 promoted
  to REQUIRED as its live witness — and it passed.
- **DD9's apparatus split predicted reality exactly**: pure logic unit-tested,
  session semantics behavior-tested, page DOM HAT-owned. The leg-2 anomaly
  (automation MCP resolving a foreign session) reconfirmed the boundary is real.
- **Crash recovery worked.** A WSL crash killed the FD session mid-HAT (during the
  F6 spawn). The working tree survived; the HAT ledger was reconstructed from the
  session transcript and backfilled; the leg resumed with zero rework and zero
  lost fixes.
- **DD10(b)'s four-part onboarding checklist headed off the 4-for-4 recurring
  gap at design time** — first flight where it didn't recur mid-leg.

## What Could Be Improved

### Process

- **The inline-fix boundary needs a scope test, not just a class test.** F7 was
  correctly classified look-and-feel, but grew to 138 lines across
  `settings.{js,css,html}` + `main.js` wiring. Candidate refinement: an inline HAT
  fix that spans more than one page/surface gets a lightweight mini-review even
  when cosmetic.
- **Broadcast-consumer audit at design time.** F6 existed because a prior flight
  added a broadcast producer without enumerating consumers. When a flight adds or
  newly exercises a mutation on a broadcast channel, design should enumerate ALL
  current subscriber pages, not just the page being changed — cheaper than finding
  it at HAT.
- **Trace "existing precedent" claims before writing them into DD prose.** Three
  design-review catches (scroll direction, focus-survival premise, confirm-area
  generalization) were all precedent claims that hadn't been traced. Review caught
  them, but tracing at design time is cheaper still.

### Technical

- **Robot-glyph SVG is now duplicated** (static markup in `index.html`'s toolbar
  indicator; hand-built `createElementNS` copy in `settings.js`). Unlike DD3's
  tracked wipe-composition triplication, this got no revisit marker — extract a
  shared builder when a third consumer appears.
- **`{ok:false}` rejections on the clear-data channel carry no reason** (wipe's
  failure path does) — distinct causes are observationally identical. Convert the
  leg-4 Validator carry-forward into a backlog item alongside pinning burner
  isolation bidirectionally.
- **The step-6 dirty-tracking witness has no automated regression net** — page DOM
  is HAT-owned by DD9, so a future regression in `commitOrRevertName`'s dirty flag
  is only caught by re-running the HAT. Highest-risk untested path in the flight;
  it was a real bug, not a theoretical one.

### Documentation

- **Widen the DD10(b) checklist wording** to cover preload-bridge method declares
  in `renderer-globals.d.ts` — the leg-3 deviation happened because the checklist's
  literal scope (shared-global modules) didn't trigger for bridge methods even
  though the same typecheck logic applies.
- **Two patterns are worth CLAUDE.md promotion**: the uniform focus rule (patch
  in place any container holding `document.activeElement`; never rebuild) and the
  shared-confirm-area transition key (`action:rowId` string, never a boolean —
  a boolean silently breaks the same-row action swap). Both will recur: every
  internal page renders from broadcasts, and history-clearing is already slated to
  slot into `JAR_DATA_CLASSES`.

## Test Suite Metrics (2026-07-10, HEAD = a095996)

- **1277/1277 pass**, 0 fail/skip/todo; no flakes observed (single run).
- Internal duration **5067 ms**; wall clock ~6.15 s.
- Trajectory: 1050 (M05 F9) → 1132 (F1) → 1154 (F2) → 1242 (F3) → **1277 (F4)**.
  Internal duration flat at ~5.06 s for four consecutive flights — that flatness is
  `automation-find.test.js`'s ~4.6 s of real-timer tests acting as a floor (~5.98 s
  standalone; every other file sub-second), NOT headroom. F3 debrief Rec 5 (mock
  those timers, est. 60–75% wall-clock cut) remains open, now with a fourth
  supporting data point — still a `/routine-maintenance` item, not a flight item.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `renderer-globals.d.ts` declares for `jarsClearData`/`jarsWipe` added at leg 3, not leg 1 | DD10(b) checklist wording didn't literally cover preload-bridge methods | Yes — widen checklist wording |
| Confirm mechanism redesigned at leg-3 review (shared area, `action:rowId` transition key) | Delete-confirm pattern doesn't generalize to sibling-visible actions | Yes — house idiom for N-action confirm surfaces |
| `settings.{js,css,html}` + `main.js` touched outside charter (F6/F7) | Pre-existing staleness bug + operator UX request surfaced at HAT | No — but adopt the broadcast-consumer audit to catch the F6 class at design time |
| HAT ledger backfilled from session transcript | WSL crash killed the FD session mid-leg; log writes lost, work preserved | Partially — checkpoint the flight log during long interactive HAT sessions |

## Key Learnings

1. Design review pays for itself most when it audits *claims of existing
   precedent* — all three pre-code catches this flight were untraced precedent.
2. Live HAT interaction finds bug classes no other apparatus can reach here
   (dirty-tracking race, cross-surface staleness) — DD9's HAT-owned remainder is
   load-bearing, not ceremonial.
3. Transcript-based crash recovery is viable and cheap when the flight log is
   otherwise disciplined — the log, not the session, is the ground truth worth
   protecting.

## Recommendations

1. **Adopt the broadcast-consumer audit** as a design-time step for any flight
   touching a broadcast channel (prevents the F6 class).
2. **Widen DD10(b)'s onboarding checklist** to preload-bridge declares at the next
   CLAUDE.md touch.
3. **Promote the uniform focus rule and the `action:rowId` confirm-transition key**
   into CLAUDE.md's recurring-patterns notes.
4. **Add a scope trigger to the inline HAT-fix protocol**: more than one
   page/surface → lightweight mini-review, even for cosmetic work.
5. **Backlog the tracked debt**: shared robot-glyph builder (on third consumer),
   `{ok:false}` reason field + bidirectional burner pin (leg-4 Validator
   carry-forwards), `automation-find.test.js` timer mocks (next
   `/routine-maintenance`), wipe-composition extraction (on fourth copy).

## Action Items

- [ ] Widen DD10(b) checklist wording (preload-bridge declares) — next CLAUDE.md touch
- [ ] Add uniform-focus-rule + confirm-transition-key pattern notes to CLAUDE.md
- [ ] Backlog: `{ok:false}` reason field on clear-data channel; bidirectional burner isolation pin (behavior-spec extension)
- [ ] Backlog: shared automation-glyph SVG builder on third consumer
- [ ] `/routine-maintenance` (post-mission): `automation-find.test.js` real-timer mocks
- [ ] Methodology: inline HAT-fix scope trigger (multi-surface → mini-review) — raise at mission debrief
