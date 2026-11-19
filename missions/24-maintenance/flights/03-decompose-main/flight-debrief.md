# Flight Debrief: Decompose main.js and Restore renderer.js Headroom

**Date**: 2026-11-19
**Flight**: [Decompose main.js and Restore renderer.js Headroom](flight.md)
**Status**: landed
**Duration**: 2026-11-19 (single day)
**Legs Completed**: 3 of 3
**Plugin version**: mission-control 1.2.4

## Outcome Assessment

### Objectives Achieved

The flight made three behaviour-neutral extractions, with a verbatim diff for each and a single flight review that confirmed them:

- **`window-capture`.** `grabWindow`, the `captureWindow` composite, moved to `src/main/window-capture.js` (298 lines). The module is Electron-free. Its sheet layer is still gated on the same `AUTOMATABLE_MENU_TYPES` object, and the save prompt is still never composited.
- **`vault-wiring`.** The lazy vault store and its lock fan-out, the lock-state broadcast, the import/restore delegates, the autolock holds, the compromise and sever state, the bundle save path, and the lazy `getVaultHuman` / `getBrowserImportFlow` all moved to `src/main/vault/vault-wiring.js` (735 lines). Five accessors replaced every raw-slot read in `main.js` (`peekVaultStore`, `peekVaultHuman`, `getCompromiseReport`, `clearCompromiseReport`, `clearSeverOffer`). The quit lock and every power-lock dep use `peekVaultStore()` only, which a scan and a counting `load()` test both pin. Finding #23's orphaned comment was fixed.
- **`renderer-headroom`.** The tab context-menu cluster (`tabCtx`, two push caches, `openTabContextMenu`) moved to `src/renderer/chrome/tab-context-controller.js` (102 lines), and its two seed calls gained `.catch` (two of finding #31's seven sites).

| Measure | Before | After |
|---|---|---|
| `main.js` | 3,269 | **2,409** (−860) |
| `renderer.js` | 1,504 | **1,447** (`RENDERER_LINE_BUDGET` 1,448 by the `split` count) |
| Tests | 7,354 | 7,378 (+24 new; 7,374 pass, 0 fail, 4 todo) |

Every source-scan pin that read moved code was re-targeted. Each kept its vacuity guard and was neuter-checked; 14 test files changed for this. Every leg ran a live smoke in dev mode on a scratch profile, each booting the app cleanly. That is the real-boot check that catches a TDZ `ReferenceError` `npm test` cannot.

### Mission Criteria Advanced

- [x] **`main.js` no longer owns the window-capture, vault-wiring and human-wiring blocks, and `renderer.js` has at least 40 lines of budget headroom.**
  - **Read in its narrowed sense, confirmed by the operator at this debrief.** "Human wiring" means the lazy `getVaultHuman` / `getBrowserImportFlow` constructors, which moved. The five composition primitives (`gestureWitness`, `injectedInput`, `mediaProxyTokens`, `documentMarks`, `revealGate`) stay in `main.js`, because both `createEngine` sites and many registrars consume them and grep pins hold them there.
  - **Headroom:** `renderer.js` fell 57 lines below the old 1,505 budget, against 40 required. The budget constant was then retargeted to the new count, per the zero-headroom rule.

## What Went Well

- **"Lowest hazard first" held.**
  - Each of the three legs needed one design-review cycle ("approve with changes") and no second.
  - Deferring map blocks 4 (MCP host) and 5 (inline IPC glue) was right. The flight's divert trigger ("the `let`→holder conversion is needed for blocks 1 and 3") never fired: getters and accessors were enough.
- **The design reviews caught the inventory errors before any code was cut.**
  - Leg 1: unused identifiers were listed, and the injected registry had to keep the name `registry` so the AC7 pins still match.
  - Leg 2: `gestureTrace` was missing; `gate`, `session` and `path` were listed but unused; there was a vacuous-pin risk in `vault-fill-human-marker`; and an "always passes" negative scan in `vault-restore-workflow-invariants`.
  - Leg 2 also: the unused imports would have broken lint.
- **The verbatim diff as the behaviour-neutrality proof.** Each move was diffed old against new with indentation and comments normalised, and the diff was re-run after Prettier. Leg 2's only code difference was `mcpServer?.` becoming `getMcpServer()?.`, and that is now pinned so a by-value capture fails. The flight Reviewer redid the diffs independently.
- **Leg 3 ran in parallel with leg 2's design review, and leg 2's implementation waited for leg 3 to land,** so two Developers never edited and tested at once. This avoided the concurrent-edit risk recorded in Flight 2.
- **New safety pins added on the way:**
  - `getMcpServer` is passed as a getter;
  - the quit lock and the whole `createPowerLock` block never call `getVaultStore(`;
  - an Electron-free scan for both new main-process modules.

## What Could Be Improved

### Process

- **The flight spec and mission criterion said "human wiring" without a boundary.** The Flight Director fixed the boundary at leg 2's design, in Flight Director Notes. The ticked criterion and the flight's Verification section were never reworded, so the reader learns the narrowed meaning only from the log, and now from this debrief. Decomposition flights should name each block's exact boundary at flight design, including what stays.
- **The size target was set before the scope was.** The "about 2,300 lines" verification target dates from the maintenance map, which assumed the primitives would move. `main.js` landed at 2,409. Each leg met its own criterion (≥240 and ≥450 lines), and the target was waved through. Set size targets after the scope is fixed.
- **Leg 2 found pins its design did not list.** The implementer found two (the `file-modes` bundle-export scan, and `vault-import-logins` AC15b, whose `MAX_BUNDLE_BYTES` literal moved under `src/main/vault/`), on top of the design review's own additions. Leg 1 had the same pattern on a smaller scale. Every extraction pays a round of pin retargeting; 14 test files changed in this flight.
- **Leg 3 first set the budget from `wc -l` (1,447) instead of the test's `split(/\r?\n/)` count (1,448).** It cost one failed test run. The leg said "the new exact count" without naming the counting rule CLAUDE.md pins to Prettier output.

### Technical

- **`vault-wiring.js` is a new 735-line behaviour owner.** It takes 13 deps and returns 25 members, which fall into three groups:
  - store and human lifecycle;
  - lock state and holds;
  - import, restore and bundle delegates.
  It is cohesive (a relocated cluster, not a grab-bag), Electron-free and tested with fakes. Its natural next split is an import/restore/bundle module separate from the store and lock wiring. The TDZ hazard moved to its construction site, where the order is now `documentMarks` / `revealGate` → wiring.
- **`main.js` is closer to a composition root, but not there.** It still owns:
  - the MCP host and toggle, with three late-bound `let`s (map block 4);
  - about 700 lines of inline IPC glue (map block 5);
  - the hold state and the `historyRecorder` / `downloadsManager` slots;
  - the session and quit flags;
  - the large deps bags.
  Blocks 4 and 5 are the honest next target.
- **Only the tab-context part of the flight's `renderer.js` cluster moved.** The flight's approach also named `openToolbarContextMenu` and the leftover bookmark-edit and star handlers. Leg 3 scoped to the tab-context cluster, which met the 40-line criterion. The rest stays available for the next renderer addition. With a zero-headroom budget, that addition still needs an extraction.
- **Coverage of the new modules is structural, not runtime.** It is 24 new unit tests, plus the retargeted invariant and source-scan pins. The import/restore delegates' cancel, sever and dialog-failure paths are covered only by their pre-existing handler tests, against fakes.

### Test metrics

- **Suite:** 7,378 tests, 7,374 pass, 0 fail, 0 skipped, 4 todo (unchanged count; the known capture cases). Wall clock **10.5 s** (`duration_ms` 10,287) at load average 2.7–5.5. No flakes in one run.
- **Against Flight 2's debrief:** 22.6–25.8 s, at load 10–17. The drop is the host, not this flight. Flight 2 already showed that `main` was equally slow under that load. This run matches the quiet-host baseline of about 9–10 s (sortie 10; maintenance 2026-11-18).
- **`ipc-gate-invariant.test.js`:** 4.81 s standalone, against 5.9 s on a quiet host at maintenance. Moving code out of `main.js` did not slow its scan, and it is still about half the suite. Squawk 0219 is still the fix.
- **The new test files are negligible:** `window-capture` 0.07 s, `vault-wiring` 0.10 s, `tab-context-controller` 0.06 s.
- **Caveat:** no same-load baseline on `main` was taken this time (Flight 2's lesson). These figures carry host-noise uncertainty.

### Documentation

- **Updated:** CLAUDE.md's Architecture bullet now names `window-capture.js` and `vault/vault-wiring.js`, and its budget sentence says 1,448. The stale comments were fixed.
- **Missing, worth adding** (it is the operator's to adopt):
  - a "lazy with peek" pattern under *Recurring module shapes*: a constructing getter plus a never-constructing `peekX()` for quit and power paths;
  - the extraction checklist rules under *Project-specific planning rules*: pins move with the code, and line budgets use the `split` count.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| "Human wiring" narrowed to the lazy constructors; the five composition primitives stay in `main.js` | The engine sites and registrars consume them, and grep pins hold them in `main.js`. The operator confirmed it at this debrief. | Yes: name each block's boundary at flight design |
| The planned `vault/human-wiring.js` was folded into `vault-wiring.js` | The flight allowed it ("one module or two") | n/a |
| `main.js` at 2,409, not "about 2,300" | The target predated the scope narrowing | Yes: size targets follow the scope |
| `renderer.js` cluster limited to tab context, which went to a new controller, not `overlay-menus.js` | That met the criterion, and `overlay-menus.js` is already large | No |
| Leg 3 ran during leg 2's design review, and leg 2's implementation was held until leg 3 landed | Disjoint files, and no concurrent test runs | Yes: parallelise design, serialise implementations |
| Two unlisted pins found during leg 2's implementation | The design's pin grep was keyed on symbols, not on moved literals | Yes: grep the moved literals too |

## Key Learnings

- **Test suites that read `main.js` source text are a shared interface.** Each extraction must find every pin that reads the moved text, by symbol AND by literal, re-target it to the new file, keep its vacuity guard, and neuter-check it. Two traps:
  - **A pin can go silently vacuous.** An `indexOf` returns -1 and a comparison against it always passes. Leg 2's design review caught one in `vault-fill-human-marker`.
  - **A negative scan can stop being able to fire** once the code it guards has moved. Leg 2 found one in `vault-restore-workflow-invariants`.
- **Write the free-identifier inventory before cutting.** It was the most error-prone part of the design: three wrong entries in leg 2, and unused names listed in leg 1. Generating it mechanically (e.g. ESLint `no-undef` on the extracted file) would be more reliable than reading by hand.
- **Lazy with peek.** A constructing getter plus a never-constructing `peek` is how the quit and power locks stay safe after the store moved behind a module boundary. The property is now pinned and unit-tested (zero `load()` calls).

## Methodology Observations

1. **`agentic-workflow`, Phase 2a (leg design, *Interface changes* risk check).**
   - **What it does:** the check asks for consumers of changed symbols to be grepped.
   - **What it missed:** source-scan pins match by text, and two unlisted pins were keyed on a moved LITERAL (`MAX_BUNDLE_BYTES = 16 * 1024 * 1024`) and a moved code shape, not on a symbol.
   - **What was expected:** for a verbatim move, also grep `test/unit` for the moved file's path and the moved code's literals.
   - **What it cost:** found during implementation, not design. The implementer fixed both, at no rework.
   - Plugin 1.2.4. Recurrence in Mission 24: 2 (Flight 2 leg 3 broke an unnamed pin; Flight 3 leg 2 found two).
2. **`agentic-workflow`, Phase 2a ("legs are immutable once `in-flight`" / design-time scope).**
   - **What happened:** a mission criterion phrase ("human wiring") had no boundary, and the Flight Director bounded it mid-flight in notes.
   - **What was expected:** the skill gives no prompt to reconcile a narrowed scope with the mission criterion text before the box is ticked.
   - **What it cost:** a ticked criterion whose words no longer match what was done, until the operator confirmed it at the debrief.
   - Plugin 1.2.4. Recurrence: 1.
3. **Local lesson:** name the counting rule in any line-budget AC (`split(/\r?\n/).length` on Prettier output), not "the count". It cost one failed run.

## Recommendations

1. **Fly the remaining `main.js` extractions in the next maintenance cycle,** with blocks named at design and size targets computed from the fixed scope:
   - **Block 4,** the MCP host and toggle → `automation-host.js`. The `let`s become holders first, both `createEngine` pins move in lockstep, and `hasAdminSession` stays a late-bound getter.
   - **Block 5,** the inline IPC glue → `register-vault-chrome-ipc.js` / `register-page-ipc.js`. Each channel keeps its class and switches.
   - Fold in Flight 2's `reveal-gate.js` write-notes split.
2. **Fix squawk 0219 (memoize the shared source scan).** `ipc-gate-invariant` is still about half the suite.
3. **Add two rules to CLAUDE.md's planning rules** (the operator's to adopt):
   - "an extraction greps `test/unit` for the moved file path, symbols AND literals, and lists every pin to re-target";
   - "a line-budget AC names the `split` counting rule".
   Also document the lazy-with-peek pattern under *Recurring module shapes*.
4. **Split `vault-wiring.js`** along its import/restore/bundle seam if it grows past its current size.

## Action Items

- [ ] Next maintenance cycle: blocks 4 and 5 of the `main.js` map, plus the `reveal-gate.js` write-notes split (Flight 2 debrief Recommendation 2).
- [ ] Squawk 0219: memoize the shared scan (existing).
- [ ] Squawk 0224: CLAUDE.md, document the lazy-with-peek pattern and the budget counting rule.
- [ ] Operator: adopt the extraction-pin planning rule (Recommendation 3).
