# Flight Debrief: Reveal Gate Covers Vault Item Writes

**Date**: 2026-11-19
**Flight**: [Reveal Gate Covers Vault Item Writes](flight.md)
**Status**: landed
**Duration**: 2026-11-18 - 2026-11-19
**Legs Completed**: 5 of 5
**Plugin version**: mission-control 1.2.4

## Outcome Assessment

### Objectives Achieved

The reveal gate's stated rule holds again: a confirmed reveal covers one item's content, not one item id.

**What was broken.** Maintenance report 2026-11-18 (finding #2) traced two attacks on an admin-scripted `goldfinch://vault` page. Leg 1 then reproduced both through the real handlers against a real store.
- **Grant swap.** One confirmation could expose every login: a Replace-copy keeps the destination's id, and grants are keyed on the id.
- **Title spoof.** The dialog named whatever title the script had just written.

**What changed.**
- **Every item write drops that item's grants in every document.** This covers save, Replace-copy, delete, and a restore commit (which drops all grants).
- **The dialog names the right title.** An item written through an internal page while the gate applies is named by the title its current secrets had before automation touched them, with `CHANGED_NOTE` (or `CREATED_NOTE`). The note travels with copied secrets.
- **Opening a downloaded file asks first while the gate applies,** from both the chrome popup and the downloads page (operator ruling 3B). The gate's sender resolution gained an explicit chrome branch, in `reveal-gate-senders.js`.
- **One `isOperatorInput` predicate** replaces the two inline injected-input checks. It uses `=== false`, so a malformed store means "not operator".
- **Squawk 0194 fixed:** the spec's poller and its timing now use the monotonic clock. The spec gained steps 12 and 13.

**How it was verified.**
- **Tests:** 7,350 pass, 0 fail. Lint, typecheck and format are clean.
- **Flight review:** confirmed. The Reviewer tried to build a spoof sequence and found none.
- **Live run:** `admin-reach-refusal` passed in full for the first time, 15 of 15 checkpoints, against a vault the operator unlocked. It observed both fixes live:
  - step 12's dialog named `Bank` while the item's live title was `Renamed-…-r2`, and showed the note;
  - step 13's open was refused, and nothing opened.

### Mission Criteria Advanced

- [x] **A reveal-gate grant covers one item's content, not one item id**, and `admin-reach-refusal` passes in full.
- [x] **Opening a downloaded program from admin-scripted code has an operator ruling**, implemented and documented.
- Mission 24's other three criteria belong to Flights 1 and 3.

## What Went Well

- **A proof leg before the fix.** Leg 1 drove all three chains through `registerVaultIpc`'s real handlers and a real `VaultStore`, and each test asserted the *correct* behaviour, so the tests failed on `main`. That made the flight's divert criterion an evidence question, not a judgment call, and the same tests became leg 2's acceptance net unchanged. The tests-only leg was the right exception to the "no tests-only legs" guideline.
- **The risk-tiered design reviews caught real defects before any code existed.** Leg 2's first review found that "the title before the write" is wrong for a Replace-copy. Its second review found that notes must travel with copied secrets, because rename-then-copy otherwise launders a spoofed title onto a brand-new item. Neither was visible in the flight's original text.
- **The normative table.** Leg 2's "writer × outcome → note" table made the second review's bypass search mechanical, and the implementer followed the table over a contradicting criterion. The audited-writers table (restore, browser import, capture saves, jar delete, MCP ops) gave each writer an explicit disposition, not a silent omission.
- **Neuter checks recorded for every pin and call site.** These cover save, copy, delete, `dropAllGrants`, the callers pin, the sender-resolver pins and the predicate pins. The flight-end Reviewer verified the claims itself rather than trusting the log.
- **The live run with the operator present.** With the vault unlocked, steps 5 and 10–12 were exercised for real, not recorded "not run" as in every earlier run. Step 8's `reason=touched` was isolated properly once the Executor found and removed step 1b's leftover raw admin session.
- **Parallel design and implementation.** Leg 3's design review ran during leg 2's implementation, and leg 4's during leg 3's. Both were read-only and touched different files, which cut wall-clock time with no conflicts.

## What Could Be Improved

### Process

- **The operator's ruling (A) was not implementable as worded.**
  - "Show the title as it was when the grant was made" cannot stop chain 2, because the script renames the item before any grant exists.
  - The Flight Director recorded a reinterpretation ("the title the item's current secrets had before automation touched them") before leg 2's design, and flagged it at the hand-off. The operator confirmed it at this debrief.
  - The lesson is upstream: when a decision is put to the operator as options, each option's text should be tested against the attack chains first. The options came from the Flight Director's own summary of the Architect's fix shapes.
- **Leg 2's criteria contradicted its own normative table.** One criterion said chain 3 shows `CREATED_NOTE`, while the table gives `CHANGED_NOTE`. It was a leftover from before review cycle 2. The rewrite edited the table and part of the criteria, and a Python string-replace pass silently missed several of the intended edits; the Flight Director caught the misses and re-applied them by hand. When a design review rewrites a normative section, re-derive the criteria from it, and check every planned edit actually applied.
- **Leg 3 broke a pin it did not name.** `reveal-gate-stranding-wiring.test.js` pins the `main.js` `isActive:` lambda that leg 3 moved. The implementer found it and re-targeted it with two neuter checks. Leg design for any leg that moves code should grep `test/unit` for source-scan pins on that code.
- **Two by-eye reads were missed in the live run** (steps 6b and 12), and each needed a rerun. In the step-12 rerun the operator answered the dialog, so the test item's secrets were released (throwaway values, redacted from evidence). The operator considers the reruns acceptable. Squawk 0222 records the spec's cadence fixes anyway: a watch-ready step, the exact strings to confirm, and the quit step numbered last.
- **The Flight Director appended to the flight log while a Developer was editing it.** No write was lost (checked after leg 3), but it was a race.

### Technical

- **`reveal-gate.js` has grown to about 668 lines and five responsibilities.** It holds grants, scripted marks, per-item write notes, applicability, and dialog building plus input handling. `createDocumentMarks` bundles two lifetimes: per-document grants and marks, dropped at commit; and process-lifetime per-item notes. Extracting the notes into their own module would make the lifetimes legible. This is a candidate for the Flight 3 decomposition, or for when the module is next touched.
- **Resolving the new id after a copy depends on a diff.** For `copied` / `kept-both`, the registrar finds the destination id by diffing `listItemsMeta` before and after the synchronous `copyItem`. If the diff is not exactly one id, no note is propagated and nothing is logged. A renamed source copied to a new item would then show its spoofed title without the note. This is unreachable today, because `copyItem` is synchronous and writes one item, but it fails open and silently. Cleaner: `copyItem` returns the written id. That changes the store's API, so it is a sortie or next-flight item.
- **The notes map is unbounded and process-lifetime.** It grows by one entry per item written while the gate applies, and there is no cap or eviction except delete. Each entry is tiny, and growth is bounded by the vault's own size. Whether a vault lock or vault removal should clear notes is an open design question. A wrong note fails safe: it adds a warning to a legitimate item.
- **The gate's definition has widened by exception.** It started as "returns a secret, mints a key, or picks where a bundle is written", and it now also covers "runs a program" (operator ruling, against the Security Reviewer's advice). Before the next widening, state a principled rule, for example "an effect the operator would not see".
- **Repeated `try {} catch {}` around each gate call.** `register-vault-ipc.js` grew by about 96 lines, and a small `safely(fn)` helper would fold these together. This is cosmetic.
- **Residuals recorded and accepted:**
  - The chrome's scripted mark is never dropped, so after one admin chrome `evaluate`, every open from that window asks until it closes. Fail-safe; recorded in CLAUDE.md.
  - An operator's own copy over a noted item, and a profile restore, can each mislabel an item. No script can cause either; recorded in `docs/vault.md`.
  - Every open asks, because opens carry no grant.

### Test metrics

- **Counts:** 7,354 tests, 7,350 pass, 0 fail, 0 skipped, 4 todo (the known capture cases). That is +31 against the maintenance baseline of 7,323.
- **Wall clock this debrief:** about 22.6–25.8 s, against about 9–10 s at sortie 10 and at maintenance 2026-11-18. **This is host load, not a regression.**
  - The host's load average was 10–17 during the debrief (one cause is a parallel agent workload).
  - Under the same load, `main` took **26.6 s** for the full suite, and `ipc-gate-invariant.test.js` took 10.1–12.5 s on `main` against 11.1 s on this branch.
  - This flight's new and grown test files sum to about 1.6 s standalone: `reveal-gate-item-writes` 0.58 s, `injected-input-invariant` 0.60 s, `register-download-ipc` 0.22 s, `reveal-gate` 0.19 s.
- **Critical path:** `ipc-gate-invariant` is still the critical path. It took 5.9 s on a quiet host at maintenance, and squawk 0219 (memoize the shared scan) remains the fix.
- **Lesson:** a timing compared across debriefs needs a same-load baseline on `main`, or it reports the host.
- **Flakes:** none observed in the three full runs during the flight and debrief.

### Documentation

- **Updated by this flight:** CLAUDE.md's reveal-gate paragraph (grant drop, write notes, "runs a program", the chrome-mark residual, sender resolution), the Downloads bullet (DD9 "except while the reveal gate applies"), and the witness / `isOperatorInput` sentences. Also `docs/vault.md` (the note table and residuals) and `docs/mcp-automation.md` (the tier list).
- **Fixed at this debrief:** the flight spec's Design Decision still read "the title as it was when the grant was made". A note recording the operator-confirmed reading has been added to the flight spec.
- **Missing, near term:** CLAUDE.md does not state the general rule this flight established: "every writer of state a gate keys on must tell the gate".

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Ruling (A) implemented as "the title belonging to the item's current secrets", not "the title at grant time" | The worded ruling cannot stop a rename made before any grant exists. Operator confirmed 2026-11-19. | Yes: record any reinterpretation in the flight log before leg design, and confirm it at hand-off |
| Leg 1 was a tests-only leg | Its result decided the flight's divert criterion | Yes: the "prove it reproduces" leg template for security fixes |
| Leg 2 got two design-review cycles; cycle 2's medium fixes were folded in without a third review | The skill caps reviews at 2, and no high issue remained | No. A third cross-check of the criteria against the rewritten table would have caught the contradiction |
| Leg 2 implemented its table over a criterion that contradicted it | The criterion was a leftover from before cycle 2 | Yes: a normative table outranks prose criteria, and the leg says so |
| Leg 5 split into part A (spec edits, rode the flight's review and commit) and part B (the live run after the commit); the leg stayed `in-flight` across a commit | One leg held both autonomous and interactive work | Maybe: split such legs into two legs next time |
| Live-run steps 6b and 12 were rerun once each, and step 12's rerun dialog was answered | The operator missed the by-eye reads | No: a watch-ready step (squawk 0222) |
| Steps were run in the order 1–8, 10–13, 9 | Step 9 quits the app | Yes: squawk 0222 renumbers |

## Key Learnings

- **Per-item security state needs a writer × outcome table first.** The defects in this flight were all "a writer the design did not consider" (Replace-copy, copy to a new item, restore). The audited-writers table and the note table found them; prose did not. Any future state keyed on an item id must also cover delete-and-recreate, id reuse and restore explicitly.
- **"Ungated because it returns no secret" stopped being true once grants existed.** A decision recorded in one era (Sortie 04, `docs/vault.md` "Not gated") was invalidated by a mechanism added later (Mission 23's per-item grants). When a mission adds a cache or grant keyed on an identity, re-examine every existing writer of that identity.
- **Sender class is a design input for any gated channel.** Guest, chrome and sheet senders resolve differently. Leg 3's chrome branch was found in design review, not in the flight design.
- **An unlocked vault turns "not run" into evidence.** Every earlier `admin-reach-refusal` run skipped the vault steps. Asking the operator to set up a throwaway vault in the scratch profile took about 2 minutes, and it made this the spec's first full pass.

## Methodology Observations

1. **`agentic-workflow`, Phase 2a (2-cycle cap on design reviews).**
   - **What happened:** leg 2's second review returned "approve with changes" with a medium bypass. Per the skill, the fixes were applied without a third review.
   - **What it cost:** the rewrite left a criterion contradicting the leg's own normative table. The implementer caught it and followed the table, recorded as a deviation. A small re-check (do the criteria match the normative sections?) after a substantive rewrite would have caught it for almost nothing.
   - Plugin 1.2.4. Recurrence in this mission: 1 (first flight debriefed).
2. **`agentic-workflow`, Phase 2b (interactive legs).**
   - **What happened:** the skill treats a leg as either autonomous or interactive (HAT). Leg 5 was both: spec edits, then a live run with the operator. The Flight Director improvised: part A rode the flight's review and commit, and the leg stayed `in-flight` across that commit until part B landed.
   - **What was expected:** a defined shape for a leg that mixes autonomous and interactive work, or an instruction to split it.
   - **What it cost:** a bent status semantic (an `in-flight` leg inside a committed flight), and a Developer report that later called part B "outstanding" after it had landed, because the report was written before the live run.
   - Plugin 1.2.4. Recurrence: 1.
3. **`behavior-test`, Phase 4 (by-eye steps).**
   - **What happened:** the skill has no protocol for steps whose evidence is the operator's eyes.
   - **What was expected:** some way to tell the operator that a by-eye moment is coming before the action fires.
   - **What it cost:** two reruns (about 3 minutes), and on one rerun the operator answered the dialog, which released the test item's secrets and added an unplanned `confirmed` line that step 9 then had to account for. The operator judged the reruns cheap.
   - Plugin 1.2.4. Recurrence: 1. The project-side fix is squawk 0222; the methodology gap is a missing watch-ready handshake in the run protocol.
4. **Local lesson, not methodology:** the Flight Director and a Developer agent both wrote to the flight log in the same window. No write was lost. Keep Flight Director notes out of files a running agent owns.
5. **Local lesson:** options put to the operator in `AskUserQuestion` were the Flight Director's paraphrase of the reviewers' fix shapes, and one paraphrase (ruling A) could not be implemented as worded. Test each option's text against the attack chains before presenting it.

## Recommendations

1. **Fix the suite's critical path (squawk 0219) on the next turnaround.** `ipc-gate-invariant` alone sets the wall clock, and every mission adds scan-based invariants.
2. **When Flight 3 decomposes `main.js`, also pull the per-item write notes out of `reveal-gate.js`** into their own module. Make the two lifetimes explicit, and decide whether a vault lock or removal clears notes.
3. **Have `copyItem` return the id it wrote,** and drop the diff in the copy handler, so note propagation cannot fail open silently. It changes the store's API, so plan it in a flight or sortie, not a squawk.
4. **Add two leg-design rules to CLAUDE.md's planning rules:**
   - a leg with a normative table states that the table wins, and its criteria are re-derived after any design-review rewrite;
   - a leg that moves code greps `test/unit` for source-scan pins on that code and lists them.
5. **Add to CLAUDE.md the rule "every writer of state a gate keys on must tell the gate",** with this flight's audited-writers table as the exemplar.

## Action Items

- [x] The flight spec's ruling (A) carries a note recording the operator-confirmed reading (done at this debrief).
- [ ] Squawk 0219: memoize the shared scan for the invariant tests (existing).
- [ ] Squawk 0222: `admin-reach-refusal` cadence fixes (existing, logged at the live run).
- [ ] Squawk 0223: the copy handler logs once, and a test covers the case where the id diff is not exactly one.
- [ ] Flight 3 or a later maintenance cycle: extract the write notes from `reveal-gate.js`, and decide the notes' lifetime.
- [ ] A sortie or flight: `copyItem` returns the written id.
- [ ] Operator: adopt the two planning rules and the "every writer tells the gate" rule into CLAUDE.md (Recommendations 4–5).
