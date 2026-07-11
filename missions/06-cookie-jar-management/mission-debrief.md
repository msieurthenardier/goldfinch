# Mission Debrief: Cookie Jar Management

**Date**: 2026-07-11
**Mission**: [Cookie Jar Management](mission.md)
**Status**: completed
**Duration**: 2026-07-09 – 2026-07-11
**Flights Completed**: 5 of 5

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1. Jar-management page reachable, lists every jar (name/color/default) | **Met** | Kebab + picker entry points; HAT-verified F3/F4. Honesty note: the *(behavior-test-backed)* tag overstates — page DOM is HAT-only by the deliberate DD9 apparatus boundary; the backing is one-time operator sign-off, not a re-runnable spec. |
| 2. Create from page, immediately usable, no restart | **Met** | HAT-verified end-to-end; IPC/routing half machine-pinned (`new-tab-default-routing` 8/8). Same DD9 honesty note applies to the page half. |
| 3. Rename/recolor propagates live; stored data preserved | **Met** | Propagation heavily witnessed (HAT F3+F4, incl. the cross-page race and the F6 settings-staleness fix). Data preservation is structural (rename mutates only name/color — id/partition immutable, F5's behavior run re-evidenced it) but never directly staged as login-survives-rename; recorded as an accepted verification gap. |
| 4. Delete: confirm, wipe, tabs close, disappears everywhere | **Met** | `jar-delete-closes-tabs` 5/5 twice + HAT confirm-UX sign-off. |
| 5. Exactly one default; new tabs route to it; movable from page | **Met** | `new-tab-default-routing` 8/8 + HAT; F5 closed the last surface-parity hole (picker default marker). |
| 6. Burner: always exists, no edit controls, evaporates; last-delete → Burner default; flag moves back on re-create | **Met** | Routing spec steps 7/8 (with falsification control) + HAT scratch-profile witness + burner rejection matrix on both channels. |
| 7. Per-jar data controls: independent clears + full identity wipe, observable | **Met** | `jar-data-controls` 7/7 first run (class independence, jar containment, reload sentinel). Caveat: "logged-in returns logged-out" proven via synthetic probe cookie, functionally equivalent, not a real login. |
| 8. Fresh profile = Personal (default) + Work + Burner | **Met** | Unit-pinned (`jars.test.js` fresh-seed case); re-witnessed live by F5's fresh-stage run. |
| 9. Upgrade preserves data; legacy jar becomes normal | **Met** | Migration three-shape dispatch fully unit-tested; real-data survival verified once, manually, on the operator's own profile (F1). No repeatable regression net — accepted gap, noted for any future store-touching mission. |

### Overall Outcome

**Achieved.** Goldfinch went from "jars exist but are unmanageable" to a full
lifecycle: a management page with settings-style layout and instant-apply
editing, default-jar semantics threaded through every surface (including the
picker as of F5), per-jar data controls with a fingerprint-persona wipe, and
the automation surface degrading correctly across jar lifecycle events —
live-witnessed end to end. v0.7.0 shipped after F4; F5's two gap-closers are
merged on main, unreleased. The mission's outcome was still the right goal at
the end; no pivot occurred.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1. jar-lifecycle-model | completed | Store v2 + migration, exactly-one-default invariant, IPC surface, `jar-ipc.js` extraction (god-file discipline) |
| 2. default-jar-semantics | completed | All five reserved-base-partition assumptions retired; default-flag routing live |
| 3. jar-management-page | completed | `goldfinch://jars` (third trusted origin), twin-registered internal bridge, popup jar inheritance, accelerator forwarder |
| 4. per-jar-data-controls | completed | Data-class taxonomy + clear/wipe IPC, settings-style relayout + uniform focus rule, broadcast-invariant net, 7 HAT findings fixed inline; WSL crash mid-HAT recovered via transcript backfill |
| 5. mission-close-gaps | completed | Audit-chartered reduced scope: picker default marker + `jar-key-revocation-on-delete` (5/5 first run) |

## What Went Well

- **Design review earned its keep every single time it ran.** Across the
  mission: F3's "asserted a nonexistent hook" catch, F4's three untraced-
  precedent catches (inverted scroll container, nonexistent focus-survival,
  non-generalizing confirm mechanism) plus the pre-HAT `commitOrRevertName`
  dirty-tracking bug found by reviewing the HAT *script*, and F5's two
  would-be gate failures (d.ts declare, admin-only apparatus). Zero review
  cycles were wasted ceremony.
- **The audit-before-charter move (F5) deleted most of a planned flight.** A
  read-only completeness audit retired five of seven tentative scope items
  with evidence and focused the remainder into a two-leg, same-day flight.
- **Verification stratification (DD9) held**: pure logic unit-tested (suite
  1050 → 1283 across the mission), session semantics behavior-tested (five
  active specs, all passing, two new this mission), page DOM HAT-owned. Each
  apparatus caught bug classes the others structurally cannot (the HAT found
  the dirty-tracking race and cross-surface staleness; the behavior runs
  closed carry-forwards; the invariant net caught `automation:set-port`
  pre-launch).
- **Crash resilience**: the WSL crash mid-F4-HAT lost only log writes. The
  working tree, all fixes, and gates survived; the HAT ledger was rebuilt from
  the session transcript with zero rework. Operator ruling at debrief: the
  crash was a fluke and is mitigated — no process change adopted (the flight
  log remains the ground truth worth protecting, and the discipline that made
  recovery cheap is already standard).

## What Could Be Improved

- **The documentation backlog compounds.** Three CLAUDE.md promotions
  (uniform focus rule, `action:rowId` confirm-transition key, widened DD10(b)
  checklist covering preload-bridge declares) have been recommended across
  three consecutive debriefs and never landed — and the DD10(b) gap
  mechanically recurred at F5 leg 1 exactly as predicted. These land before
  the history mission (its internal page, confirm surfaces, and bridge
  methods hit all three patterns).
- **`main.js` crept back** (+179 net lines this mission despite F1's
  extraction ethic) — the "one flight extracts, later HAT riders re-feed"
  pattern is now visible across two missions. Routed to routine maintenance
  as a check, not urgent.
- **The classic-`<script>` shared-scope substrate caused its third
  real-boot-only defect class this mission.** The vm-replay nets contain it,
  but the root cause (no ES modules in `src/shared/` — now 19 dual-export
  modules) is queued for maintenance and should be resolved before history
  adds more modules onto the same footgun.

## Lessons Learned

1. **Trace precedent claims at design time.** Every expensive design-review
   catch this mission was an untraced "existing precedent" assertion. Cheaper
   to trace while writing the DD than to catch at review — and cheapest of
   all compared to catching it mid-implementation.
2. **Premise-audit a new behavior spec before its first run.** F5's spec
   review caught an apparatus-authorization error (admin-only chrome ops)
   that would have burned a full two-agent live run. First-run specs are
   design artifacts and deserve design review.
3. **Broadcast-consumer audits belong at design time.** F4's F6 (settings
   page stale on `jars-changed`) existed because a producer was added without
   enumerating consumers. Any flight touching a broadcast channel should list
   all current subscriber surfaces in its design.
4. **Apparatus anomalies can be evidence.** F5's idle-session prune produced
   an in-run negative control (404-pruned-valid vs 401-revoked) stronger than
   the spec alone; the Flight-4 "foreign session" MCP anomaly turned out to be
   the operator's own second instance — both are now documented rather than
   mysterious.

## Methodology Feedback

- **ADOPTED (operator ruling at this debrief): multi-surface inline-HAT-fix
  scope trigger.** An inline HAT fix spanning more than one page/surface gets
  a lightweight design-review spawn before implementation, even when
  classified look-and-feel. Two flights of data (F3's indicator rework, F4's
  F7) show the fix-vs-feature line needs a scope test, not just a class test.
  To be written into the agentic-workflow skill (mission-control side).
- **DECLINED (operator ruling): per-step HAT flight-log checkpointing.** The
  crash that motivated it was a fluke and has been mitigated; transcript
  recovery proved cheap. No process weight added.
- **Recommended for AUTHORING.md** (mission-control side, next methodology
  touch): live-session fixtures and the idle-pruning hazard + the
  daemon-held-transport pattern (proven canonical in F5's run); premise-audit-
  before-first-run as standard spec practice.
- The mission/flight/leg hierarchy and the deferred-review batch protocol
  worked without friction across all five flights; phase gates were honored
  (F5's charter came from an operator ruling on audit findings, not a skipped
  gate).

## Action Items

- [ ] **Run `/routine-maintenance` before history-mission planning** (operator
      ruling: maintenance first). Priority inputs: ES-module conversion for
      `src/shared/`; `automation-find.test.js` timer mocks; `main.js` growth
      check; the `{ok:false}` reason-field quick win.
- [ ] **Land the three CLAUDE.md pattern promotions** (uniform focus rule,
      `action:rowId` key, widened DD10(b)) — fold into maintenance or the
      first history flight's doc pass.
- [ ] **Mission-control**: write the adopted multi-surface HAT-fix scope
      trigger into the agentic-workflow skill; add the AUTHORING.md notes.
- [ ] **History-mission planning inputs** (from the Architect's forward
      analysis): per-jar vs global history is an explicit day-one design
      decision (per-jar strongly indicated — partition is the isolation unit;
      Burner mechanically excluded via the existing no-partition guard); do
      NOT copy jars.js's whole-file-rewrite persistence for a write-heavy
      store (SQLite-class substrate already implied by mission 06's own
      text); `history-changed` broadcasts likely need invalidation-signal
      semantics, not full-payload snapshots; `goldfinch://history` slots into
      the four-origin allowlist mechanically; `JAR_DATA_CLASSES` is the
      verified extension point for history-clearing (and plausibly the
      fourth wipe-composition copy that triggers DD3's extraction clause);
      automatability of history is a privacy-relevant product decision to
      make explicitly at mission design.
