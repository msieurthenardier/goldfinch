# Flight Debrief: Crash and Hang Resilience

**Date**: 2026-09-17
**Flight**: [Crash and Hang Resilience](flight.md)
**Status**: landed → completed (2026-09-17)
**Duration**: 2026-09-16 (planning + branch) – 2026-09-17 (HAT landed; PR #219)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved

The flight delivered its objective in full: a dead renderer is a crashed
tab (hidden guest, the Flight 1 panel specialised with reason copy and a
Reload that keeps history, a marked strip entry, census `crashed`); a
frozen one is a hung tab (a non-blocking bar with Wait and Kill-and-reload,
cleared when the renderer answers, with immediate "Stopping the page…"
feedback); a dead chrome renderer reloads at once and reconciles every
registry tab through the boot barrier — internal tabs included — capped at
three reloads per minute; every crash writes a closed eight-field record
whose origin is host-only, and Chromium's minidumps stay local, pruned to
twenty. The substrate leg cut `renderer.js` from 1806 to 1532 lines before
any feature glue and settled ten spike premises live.

Verification: `npm test` 4996/4996; lint, typecheck, format clean;
`npm run a11y` exit 0 with `crashed` and `hung` audited; the Witnessed
`crash-and-hang-surfaces` run 14/16 pass with one by-eye clause closed at
the HAT and one failed row fixed in-run and re-verified; a seven-step HAT
with four look-and-feel fixes.

### Mission Criteria Advanced

- **6 A crashed tab recovers in place** — met (panel, Reload with history,
  strip mark, reason copy).
- **7 A crashed chrome view recovers without losing the window** — met
  (reload-and-reconcile, same active tab, guests untouched, storm cap).
- **8 A hung tab offers wait-or-kill** — met (bar, Wait, Kill-and-reload,
  self-clearing on `responsive`).
- **9 Every crash leaves a local record** — met (closed field set, local
  dumps, no egress observed in any sample).
- **10 New surfaces are safe and accessible** — partial: census
  `crashed`/`hung` complete the enum; the new surfaces pass the a11y audit;
  keyboard reach after a typed failure remains Known Issue #216.

## What Went Well

- **Spike-first paid for itself.** DD3's premise (`forcefullyCrashRenderer`
  yields `killed`) was wrong; spike (f) found it before leg 2 existed and the
  fix was a zero-cost DD amendment (gate on the flag alone).
- **The design reviews caught real bugs before code.** Flight cycle 1: the
  dev-profile placement of `crashReporter` (dumps would have landed in the
  real profile), popups outside the registry, guest pushes bypassing the
  boot queue. Flight cycle 2: nulling `restoreTabs` would have defeated the
  boot-restore hazard gate. Leg 3 cycles: an internal tab re-adopted as a
  web page, unconditional activation on adopt, the `sendOrQueue`
  construction order, the popup `windowId`.
- **The closed field set as a security control.** `record()` destructures
  its input into an eight-key literal — a language-level guarantee — with a
  source-scan pin; the Validator re-derived the invariant from raw evidence
  and found it clean.
- **The dedicated acceptance leg found two defects every unit suite
  missed** (F1: a paused window still reported booted and wedged
  `enumerateTabs`; F2: the dump prune probed a doubled path), plus a
  pre-existing contrast violation through the new a11y states. Second
  flight in a row this leg earned its keep — it is load-bearing methodology
  now.
- **Fix-and-continue during the run** (operator-endorsed): fix, relaunch,
  re-run the failed row as 12b — the run log carries the 12/12b pair as the
  fix-verification record.
- **Behaviour-preserving extraction, proven.** `overlay-dispatch.js` was
  diffed byte-for-byte against the pre-move switch at the flight-end
  review; 47 behaviour pins where the switch had none.
- **One definition each**: `pushTabStateFor` (the re-push set, shared by
  move/adopt and recovery), `guestTakenOver` (every focus/visibility site,
  grep-AC over all of `src/main/`), `deriveStripLoadState` (one strip
  writer), `refreshTabIndicators` (one chip owner).
- **Test suite health**: 4996/4996, 0 skipped, no flakes, 5.33 s wall
  clock — +213 tests over Flight 2's 4783 at the same speed band
  (4.97 s → ~5.5 s → 5.33 s); no new slow suite (the new modules are
  fs- and Electron-free; the SQLite/crypto suites remain the slowest).
- **Key hygiene held**: env-only admin key, scripts that never print it,
  every scratch log shredded; the one incident (a file-change notification
  quoting a log) was contained by rotation at the next launch.

## What Could Be Improved

### Process

- **Same-flight DD composition.** DD8's `crashReporter.start` changed the
  process's signal behaviour that DD10's apparatus depended on; leg 1's
  spike ran without the reporter, leg 3 added it, and the acceptance run
  found `kill -SEGV`/`-ABRT` no longer crash a sandboxed guest. The Flight 2
  debrief's "compose the DDs on paper" lesson applies within a flight too:
  when a later DD installs a global hook, re-verify earlier spike premises.
- **A leg's live smoke should exercise the OTHER apparatus primitives
  against its new state.** Leg 3's smoke reached the paused state and read
  `enumerateWindows`, never `enumerateTabs` — F1 would have been caught a
  leg earlier.
- **Two known facts were never composed at planning**: the frameless window
  keeps its close button in the chrome DOM, and DD6 leaves the chrome dead on
  pause — so a paused window has no exit from inside. The operator ruled it
  an accepted edge case; the design reasoning should have surfaced it.
- **Zero-headroom budget.** `renderer.js` landed leg 2 at exactly 1577/1577;
  two HAT fixes had to hunt for offsetting trims. DD11 lowered the ceiling
  but left no slack for a flight this size.
- **Design-time UX question missed**: "what does the operator see for the
  5–12 s between clicking Kill and reload and the reload" — the feedback
  state shipped as a HAT fix, not a leg 2 feature.
- **Spec authoring**: the STOP-based kill-reload row could never work (a
  stopped process cannot service the kill IPC); row 6's guest-visibility
  clause is a by-eye observable (a stopped renderer yields no compositor
  frame); AC8's whole-tree `spike` grep was unsatisfiable. Each was found
  live rather than at authoring.
- **Evidence discipline**: a post-loop read must be saved as its own file —
  the Validator had to re-probe once.

### Technical

- **SEGV under the crash reporter** (operator ruling: documented, not
  spiked): with `crashReporter` active, `SIGSEGV`/`SIGABRT` do not crash a
  sandboxed guest on this rig (only `SIGKILL` does) and a SEGV on the
  unsandboxed chrome takes ~15 s to register. Working hypothesis: Crashpad's
  in-process handler under the seccomp sandbox. Consequence: a real
  page-triggered segfault may present as a hang (bar) rather than a crash
  (panel). Documented here and in the crew file; revisit if a real crash
  ever shows as a hang.
- **Two TDZ hazards from one verbatim move** (`pageCtx`/`tabCtx` caught at
  review; the `const` thunks caught by lint) — extractions of this shape
  need a standing "anything referenced above the construction site" check.
- **`window-boot-config` has grown three branches plus the dedupe inline** —
  correct and pinned, but the next touch should extract the dedupe-and-flush.
- **Untested path**: the gap-queue dedupe's non-`wcId` message branch.
- **Crashpad artefact count**: 4 dumps for 2 trapped crashes; the
  prune-vs-live-write race is theoretical and undocumented.
- DD11's prose says the hung push refreshes the chip; `onTabHung` never
  needed to (the chip never reads `hung`).

### Documentation

- Crew-file apparatus facts from this run are not yet in
  `.flightops/agent-crews/behavior-tests-execution.md`: SEGV/ABRT vs a
  sandboxed guest (use KILL), capture-timeout on a stopped renderer
  (`[by-eye]`), ~15 s SEGV latency on the chrome (pace by `chromePid`),
  `openTab` returns a bare number, `navigate`-after-`openTab` race,
  same-origin tabs may share a renderer, post-loop reads need their own
  file, re-resolve THE window by `lastFocused` after a relaunch, a wedged
  `enumerateTabs` can be product not apparatus.
- `docs/dev-testing.md` lacks the prune-vs-write race sentence.

## Deviations and Lessons Learned

- **Leg 3 point fixes folded without a third review cycle** (four,
  code-verified, decision-free) — the operator confirmed this as the
  standing rule: the Flight Director folds mechanical fixes at the cap;
  only design questions escalate.
- **Consequential test retargets** in every leg (exact-literal pins on
  return shapes and line counts) — accepted as deviations; the pins are
  doing their job.
- **`kill -KILL` substituted for `-SEGV`** in the storm and crash-loop rows
  (guest: SEGV does not crash; chrome: SEGV's latency would have made the
  60 s cap a timing test) — the cap and the records are reason-agnostic, so
  the rows still test what they claim.
- **Precondition repair at row 0**: stale `failed` tabs from the a11y audit's
  session snapshot; one in another window would not close (`closeTab`
  returned `false`) — carried as a squawk candidate.
- **H5 ruling**: the paused window's black chrome area is an accepted edge
  case (operator, pre-debrief); the two directions (a main-owned recovery
  overlay; close-on-pause after a snapshot) stay on file.

## Key Learnings

1. A closed field set enforced by destructure-not-spread plus a source-scan
   pin is the default shape for any "must never leak X" sink.
2. Per-tab state on its own push channel worked cleanly for the second
   flight running; `pushTabStateFor` makes the re-push set one definition
   with two collaborators and two test suites.
3. An "act + observe" apparatus DD that is reason-agnostic lets the live run
   substitute signals without a spec rewrite.
4. A later DD that installs a global hook can invalidate an earlier DD's
   spike premises inside the same flight.
5. A stopped renderer produces no compositor frame — visibility under
   `SIGSTOP` is a by-eye observable, permanently.
6. The frameless window's only exit lives in the chrome DOM; any state that
   kills the chrome needs a main-owned affordance or an honest close.

## Recommendations

1. **Extract before the next `renderer.js` touch.** Pull the panel-family
   projection glue (welcome / load-failure / crash / hang) out of the
   activation path into a shared controller, the `overlay-dispatch.js` way,
   and re-pin with real headroom (≥ 60 lines).
2. **Standing spec rule**: a leg's live smoke exercises every existing
   apparatus primitive against the leg's new state (census, windows,
   capture, evaluate), not only the primitive the leg added.
3. **Standing planning rule**: when a DD installs a global hook
   (`crashReporter`, an `app.on`, a session-wide listener), list which
   earlier spike premises it could change and re-run them in that leg.
4. **Paused-window UX** stays a backlog design item (operator: accepted edge
   case) with the two directions recorded; pick it up when the next flight
   touches chrome recovery.
5. **Ask the "what does the operator see while waiting" question at design
   time** for any action with multi-second latency.

## Action Items

Squawk candidates (single item, no design, bounded, verifiable):

- [ ] Crew-file apparatus notes from the acceptance run (servicing) — see
      Documentation above. **Squawk 0082.**
- [ ] `closeTab` returns `false` for a `failed` tab in a background window
      (defect; reproduce, fix or document). **Squawk 0083.**
- [ ] Unit-pin the gap-queue dedupe's non-`wcId` branch in
      `app-lifecycle.test.js` (servicing). **Squawk 0084.**
- [ ] `docs/dev-testing.md`: one sentence on the prune-vs-live-write race;
      CLAUDE.md: the SEGV/Crashpad finding, the same-flight DD composition
      rule, the extraction TDZ checklist; DD11's hung-push wording
      (servicing). **Squawk 0085.**

Debrief recommendations (design work, next flight/mission): 1, 2, 3, 5
above; 4 is backlog by ruling.
