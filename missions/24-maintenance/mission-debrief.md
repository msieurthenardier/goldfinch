# Mission Debrief: Maintenance

**Date**: 2026-11-19
**Mission**: [Maintenance](mission.md)
**Status**: completed
**Duration**: 2026-11-18 - 2026-11-19
**Flights Completed**: 3 of 3
**Plugin version**: mission-control 1.2.4

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| A release cannot be built from a commit that fails the audit or fuse gate | met | Flight 1. `build.yml` runs `npm audit --audit-level=high` on the Linux entry BEFORE `npm ci`. Pinned: the exact step, its placement, the fuse check on every platform, and `upload` requiring every build entry to succeed. Dispatch run 44456941596 passed. **The tag path is first confirmed at the next real release.** |
| Dependabot cannot quietly regress SHA pinning, and the runtime is on the current Electron 45 patch | met | Flight 1. A re-pin note in `dependabot.yml`, pinned by a test. It is advisory: CI still catches an unpinned action only after merge. Electron is 45.4.1: suite, fuses, live smoke, and `third-party-cookie-isolation` 14/14. |
| A reveal-gate grant covers one item's content, not one item id, and `admin-reach-refusal` passes in full | met | Flight 2. Every item write drops its grants. Dialogs name the title belonging to the item's current secrets, and that title follows the secrets through a copy. `admin-reach-refusal` passed in full for the first time, 15/15, with the operator unlocking the vault and reading the dialogs by eye. |
| Opening a downloaded program from admin-scripted code has an operator ruling, implemented and documented | met | Flight 2, ruling (B): while the gate applies, `openDownload` asks first, from both entry points. Observed live in step 13. |
| `main.js` no longer owns the window-capture, vault-wiring and human-wiring blocks, and `renderer.js` has ≥ 40 lines of headroom | met (narrowed sense, operator-confirmed) | Flight 3. `main.js` went from 3,269 to 2,409 lines. "Human wiring" means the lazy constructors; the five composition primitives stay in `main.js` by design. `renderer.js` went from 1,504 to 1,447, 57 lines below the old 1,505 budget. |

### Overall Outcome

**The mission achieved its outcome.** All three Action Required findings from maintenance report 2026-11-18 are resolved:

- **The reveal gate holds again.** Its grant could be swapped under a Replace-copy; it now covers what was approved and nothing else.
- **Releases now run their own audit gate.** The last three tags had been cut on commits that failed it.
- **The composition root is smaller.** `renderer.js` has room for the next feature.

The reveal-gate fix mattered most. The swap broke a guarantee Mission 23 had only just delivered, needed only the admin automation key, and was proven by a failing test before it was fixed. One premise turned out wrong along the way: the `picomatch` advisory behind finding #1 was withdrawn, not patched, on the inspection day itself. That simplified Flight 1 rather than invalidating it, because the release-integrity half of the finding ("releases don't see their own gate") was real regardless.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| [02 Reveal Gate Covers Vault Item Writes](flights/02-reveal-gate-item-writes/flight.md) | completed | The grant swap and the rename spoof were proven, then fixed through a normative note model. The open-download gate added a chrome-sender branch. One `isOperatorInput` predicate replaced two copies of the check. `admin-reach-refusal` passed in full, 15/15. |
| [03 Decompose main.js and Restore renderer.js Headroom](flights/03-decompose-main/flight.md) | completed | Three behaviour-neutral extractions (`window-capture.js`, `vault/vault-wiring.js`, `chrome/tab-context-controller.js`). Each was diffed against the original, and every source-scan pin was re-targeted and confirmed to fail when its subject is removed. |
| [01 Release Integrity](flights/01-release-integrity/flight.md) | completed | The release build runs the audit gate, un-held after the advisory was withdrawn. The Dependabot re-pin note is in place, and Electron is 45.4.1 with the cookie-isolation gate run. |

The flights ran in the order 2, 3, 1. The operator put the security fix first, and Flight 1's audit leg was held until it was un-held mid-flight.

## What Went Well

- **Proving a vulnerability before fixing it.** Flight 2's first leg drove all three attack chains through the real handlers and a real vault store. Its tests asserted the correct behaviour, so they failed on `main`. That turned the flight's divert criterion into evidence, and the same tests became the fix's acceptance net unchanged.
- **Risk-tiered design reviews caught real defects before code existed:**
  - Flight 2: a Replace-copy titled the wrong item; notes had to travel with copied secrets, or rename-then-copy launders a spoofed title; the chrome-sender gap in the gate's window resolution.
  - Flight 3: wrong free-identifier inventories; a pin that would have gone silently vacuous; a negative scan that could no longer fire.
  - Flight 1: placing the audit before `npm ci`; pinning the gate's *effect*.
  - **No high-severity issue reached code.** One second review cycle was needed in the whole mission, and none was needed after.
- **Behaviour-neutral extraction with evidence.** Flight 3 diffed each moved block, old against new with comments and indentation normalised, and the flight reviewer redid the diffs independently. Leg 2's only code change was `mcpServer?.` becoming `getMcpServer()?.`, and that is now pinned.
- **Two first-ever full live passes.** `admin-reach-refusal` passed 15/15 with an operator-unlocked vault; every earlier run had skipped the vault steps. `third-party-cookie-isolation` passed 14/14 on 45.4.1, with two app-driven restarts attested.
- **Coordination.** The operator described it as smooth: one maintenance cycle, three flights, two live runs and five PRs in about a day. Parallel design reviews alongside sequential implementations kept wall-clock time down with no conflicts.

## What Could Be Improved

- **Operator questions were asked before they were fully verified.** This happened twice, and the operator now wants verification first.
  - **Ruling (A) on the reveal title.** The option text ("title as of grant time") could not stop the rename attack as worded. The Flight Director reinterpreted it before leg design, flagged it at hand-off, and the operator confirmed at the debrief.
  - **The audit hold.** "Wait for an upstream `picomatch` fix" was ruled on a premise checked by `first_patched_version` only. GitHub had already withdrawn the advisory; it surfaced only because the Electron leg's audit came back clean.
  - **The lesson:** before putting options to the operator, test each option's text against the facts and attack chains, and re-query any external state (`withdrawn_at` included), recording the query and its date.
- **Leg specs kept missing source-scan pins.** Flight 2, leg 3 broke a pin it didn't name. Flight 3, leg 2 found two pins its design didn't list (one keyed on a moved literal). Every extraction pays a pin-retargeting round; 14 test files changed in Flight 3 alone.
- **Scope phrases without boundaries.** "Human wiring" (a mission criterion) and "about 2,300 lines" (a flight target) were set before the scope was fixed, then narrowed mid-flight. Both were recorded honestly, but the ticked criterion's words no longer matched the work until the operator confirmed.
- **Normative content and prose criteria drifted.** In Flight 2, leg 2, a criterion contradicted the leg's own normative table after a design-review rewrite, and the Flight Director's batch edit silently missed several replacements. The implementer followed the table.
- **Live by-eye steps had no handshake.** Two dialog reads were missed in the `admin-reach-refusal` run, and one rerun dialog was answered, releasing throwaway secrets. The operator judged the reruns cheap. Squawk 0222 adds a watch-ready step to the spec.
- **Timing across debriefs reported the host, not the code.** Flight 2's debrief saw 23 s against about 10 s; a same-load run on `main` proved it was host load. Every timing comparison needs a same-load baseline.

## Lessons Learned

**Technical**
- **Per-item security state needs a writer × outcome table first.** Every Flight 2 defect was a writer the design hadn't considered: Replace-copy, copy to a new item, restore. The table found them; prose did not. State keyed on an item id must also handle delete-and-recreate, id reuse and restore.
- **A decision recorded in one era can be invalidated by a mechanism added later.** "Save and copy are ungated because they return no secret" (Sortie 04) became false once Mission 23 added per-item grants. When a mission adds a cache or grant keyed on an identity, re-examine every existing writer of that identity.
- **Pin a gate's effect, not just its existence.** The audit step is only a gate because `upload` requires every build entry to succeed. That condition is now the pinned property.
- **Lazy with peek.** A constructing getter plus a `peekX()` that never constructs keeps quit and power paths from building what they only need to read. It is pinned and unit-tested (zero `load()` calls). Squawk 0224 documents it.
- **Source-scan pins are a shared interface.** An extraction must grep `test/unit` for the moved file's path, its symbols *and its literals*, re-target each pin, keep its vacuity guard, and confirm it still fails.

**Process**
- **Re-verify external facts at decision time.**
- **Name boundaries and size targets after scope is fixed, not before.**
- **When a design review rewrites a normative section, re-derive the criteria from it.**
- **Verification that costs real CI time** (a `workflow_dispatch`) needs the operator's go-ahead and an honest statement of which path it proves.

**Domain**
- **The reveal gate's job is to stop the dialog from being misled about what it releases,** not only to ask. That is why the title note exists.
- **Opening a downloaded program is now inside the gate's scope** while automation is active (operator ruling). The definition has grown by exception ("returns a secret, mints a key, picks a destination, runs a program"). A principled rule, such as "an effect the operator would not see", should come before the next widening.

## Methodology Feedback

Plugin version: mission-control 1.2.4 throughout. Destination per finding. The methodology observations below restate flight-debrief observations, so a sweep should count each once.

1. **Methodology observation.** `agentic-workflow` Phase 2a, the *Interface changes* risk check: it keys on symbol consumers, so it misses source-scan pins that match moved TEXT (literals, code shapes).
   - **Recurrence:** 2 of 3 flights (F2 leg 3; F3 leg 2, two pins).
   - **Cost:** pins found during implementation rather than design. No rework, but unplanned edits in two legs.
   - **Sources:** F2 debrief (process); F3 debrief observation 1.
2. **Methodology observation.** `agentic-workflow` Phase 2a, the 2-cycle design-review cap: after a substantive rewrite in the second cycle, nothing re-checks the criteria against the rewritten normative section.
   - **Recurrence:** 1 (F2 leg 2).
   - **Cost:** a contradictory criterion reached the implementer, recorded as a deviation.
   - **Source:** F2 debrief observation 1.
3. **Methodology observation.** `agentic-workflow` Phase 2b: no shape for a leg that is part autonomous, part interactive or outward-facing.
   - **Recurrence:** 2 of 3 flights:
     - F2 leg 5 (spec edits plus a live run with the operator);
     - F1 leg 1 (implementation plus a `workflow_dispatch` that needs the operator's go-ahead).
   - **Cost:** the leg status was bent: an `in-flight` or `landed` leg sat inside a committed flight across commits. One Developer report described a part as outstanding after it had landed.
   - **Sources:** F2 debrief observation 2; F1 debrief observation 2.
4. **Methodology observation.** `behavior-test` Phase 4: no protocol for steps whose evidence is the operator's eyes.
   - **Recurrence:** 1 (F2 live run).
   - **Cost:** two reruns, and one answered dialog that released throwaway secrets.
   - **Project-side fix:** squawk 0222.
   - **Source:** F2 debrief observation 3.
5. **Methodology observation.** `routine-maintenance` → operator ruling → `agentic-workflow` Phase 1: a finding resting on external state is never re-validated before it drives a decision.
   - **Recurrence:** 1 (finding #1 / F1).
   - **Cost:** a leg held, and an operator ruling made on a stale premise.
   - **Source:** F1 debrief observation 1.
6. **Methodology observation.** `agentic-workflow` Phase 2a: nothing prompts a check that a scope narrowed mid-flight still matches the mission criterion's wording before its box is ticked.
   - **Recurrence:** 1 (F3).
   - **Cost:** a ticked criterion whose text no longer matched the work until the operator confirmed it.
   - **Source:** F3 debrief observation 2.
7. **Local lesson.** Options put to the operator must be tested against the facts before asking.
   - **What happened:** ruling (A) was not implementable as worded, and the audit hold rested on an unchecked premise.
   - **Classification:** it is the Flight Director's practice, not the skill's, and no rework resulted. The operator asked for verify-first.
8. **Local lesson.** The Flight Director and a Developer agent wrote to the same flight log concurrently (F2). No write was lost. Keep Flight Director notes out of files a running agent owns.
9. **Local fix (crew file).** `.flightops/agent-crews/behavior-tests-execution.md`: a stray hung background task in the Executor blocked hand-back delivery mid-run (F1 run).
   - **Fix:** add to the Executor's apparatus notes "every MCP client script ends with `process.exit(0)`; never leave a background task running".

## Action Items

**Next cycle (operator: squawk turnarounds first)**
- [ ] Squawk 0219: memoize the shared source scan (`ipc-gate-invariant` is about half the suite). Highest value.
- [ ] The Mission 24 squawks, as one or two turnarounds:
  - **Docs and tests:** 0210, 0212, 0216, 0217, 0218, 0219, 0222, 0224, 0225, 0226.
  - **Code:** 0211, 0213, 0214, 0215, 0220, 0221, 0223.
- [ ] The older batches from maintenance triage:
  - **downloads:** 0179, 0180, 0184, 0198, 0199;
  - **drift and docs:** 0174, 0175, 0206, 0207, 0208, 0209, 0204;
  - **spec edits:** 0173, 0185, 0186.

**Verification**
- [ ] Next real release: confirm the audit step on the tag path, and record it in the release-prep PR.

**Operator rulings**
- [ ] Add `npm test` / typecheck / lint to the release build, or a check that the tagged commit passed Concourse.
- [ ] Authorize `fly` for future reviews.
- [ ] Delete `origin/mission/23-debrief`.
- [ ] Close issues #174 and #104 after confirming.
- [ ] Assign an owner for Mission 23's 12 unwalked by-eye checklist items.
- [ ] Adopt the planning rules recommended across the flight debriefs into CLAUDE.md:
  - extraction pins are found by path, symbols and literals;
  - a normative table outranks prose criteria, and criteria are re-derived after a rewrite;
  - line-budget criteria name the `split` count;
  - boundaries and size targets are set after scope;
  - external-state premises are re-queried at decision time.

**Next maintenance or mission candidates**
- [ ] Finish `main.js`: block 4 (the MCP host and toggle, as `automation-host.js`) and block 5 (the inline IPC glue).
- [ ] Split `reveal-gate.js`: policy (the note table), dialog presentation, and per-document state. Decide the notes' lifetime and bound. Notes are the one unbounded per-item map; growth is bounded by vault size, but cap or evict.
- [ ] `copyItem` returns the id it wrote (removes 0223's fail-open path).
- [ ] A principled definition of the reveal gate's scope before any further widening.
- [ ] A drift guard across the gate-wiring lists (`GATED`, `CHANNEL_CLASS`, `SHEET_MENU_TYPES`).
- [ ] Sortie candidates carried from maintenance:
  - partial vault-failure policy (V1, 0190, 0191);
  - popup / tab / download caps (0187, #144);
  - WebGPU farble policy (0196);
  - the app token on script requests (0197).

**Local fix**
- [ ] `.flightops/agent-crews/behavior-tests-execution.md`: Executor apparatus note on `process.exit(0)` and no lingering background tasks (Methodology Feedback 9).

**Methodology**
- 24 mission debriefs and 10 sortie debriefs exist, and no service report has been run. Observations 1 and 3 above recurred in two of this mission's three flights. `/mission-control:service-report` is the operator's to run when they choose.
