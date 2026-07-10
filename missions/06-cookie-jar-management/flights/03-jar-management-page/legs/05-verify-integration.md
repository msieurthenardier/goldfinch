# Leg: verify-integration

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

Flight 3's work is proven against the real app (boot smoke + three behavior tests)
and documented (CLAUDE.md jars-page docs + the two-flights-overdue architecture
pattern note; `new-tab-default-routing` spec extended per its first run's Validator
notes). CP4 gate.

## Context

- **Split execution (FD process note)**: the flight-level review/commit
  (`7461346`) deliberately landed BEFORE this leg so verification runs against a
  committed baseline — this leg's own outputs (docs, spec extension, run logs)
  get a scoped review + second commit, mirroring F2's two-commit shape. The
  Developer executes the doc/spec/smoke work; the Flight Director runs the three
  behavior tests directly via `/behavior-test` (the run skill orchestrates its own
  Executor/Validator crew — never a Developer job).
- **DD9 boundaries govern what the smoke can observe**: internal-page DOM is
  unreachable by the apparatus even under admin (op-local guards in
  src/main/automation/observe.js). The boot smoke therefore proves: app boots on
  a fresh scratch profile; `window.openJarsPage()` is chrome-eval-reachable and
  opens an internal tab (enumerateTabs shows it; its title arriving as
  "Cookie Jars — Goldfinch" proves the page document loaded under the internal
  CSP); chrome-driven jar mutations still behave (picker/tab-dot observables).
  Page-DOM behavior (list content, live updates, CRUD) is HAT-verified — do not
  scramble for a page-DOM seam.
- **Behavior tests (FD-run, in this order)**:
  1. `jar-delete-closes-tabs` (first run of the Leg-design draft) — gates DD6.
  2. `popup-jar-inheritance` (first run) — gates DD7.
  3. `new-tab-default-routing` (re-run AFTER the Developer extends it) — F2's
     standing regression gate, extended per its 2026-07-10 run's Validator notes.
  A failing behavior test is an unmet acceptance criterion: the leg does not land
  while any fails (fix in a new commit, re-run; no amends).
- **Spec extension (`tests/behavior/new-tab-default-routing.md`), exactly the
  Validator's three notes**: (a) step 5's list/get-default reads become explicit
  Actions (they're currently asserted in Expected Results only); (b) the step-7
  auto-claim causal clause gets an explicit post-add `jarsGetDefault()` expected
  result PLUS a follow-on step adding a SECOND jar into the non-empty registry
  and asserting the default does NOT move (the only way to distinguish auto-claim
  from an always-default-new-jars bug); (c) codify step 1's live-flag read
  (`jarsGetDefault()`/`jarsList()`) into the spec's step 1 Actions. Update the
  spec's step count references; Status stays `active`.
- **Docs (DD10)**:
  - Goldfinch `CLAUDE.md`: add the jars page wherever it documents special pages
    / internal architecture (frame by intent — follow the file's own structure),
    AND the overdue architecture pattern note (F1 rec 4, F2 rec 3): the
    Electron-free injected-deps module pattern + the dual-export pure decision
    module pattern (name the exemplars), the two real-boot defect classes
    (mkdirSync-before-synchronous-persist; classic-`<script>` shared-scope
    collision — plus the vm-net counter-measure), and the grep-AC exemption
    convention. Keep it a compact pattern note, not an essay.
  - `docs/mcp-automation.md`: verify + one light-touch generalization
    (design-review finding): phrasing like "the internal `goldfinch://settings`
    tab" (~:319-320) predates downloads and jars sharing the internal session —
    generalize to the internal session's tabs while in the file. Nothing else
    unless now-false.
  - README: only if it enumerates user-facing surfaces.
- **Apparatus recipe (proven in F1/F2)**: scratch profile via `XDG_CONFIG_HOME`,
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run
  dev:automation`; the bound port may be a free-port fallback (49709/49710 seen
  on this rig) — discover, never assume; the admin key is a ONE-TIME stdout
  print (`AUTOMATION_DEV_MINT {...}` — main.js:2652-2655), NOT an env var; kill
  the launcher node tree by pid at teardown (dev-launch.mjs curates the child
  env).
- **Staging model (design-review ruling — supersedes any shared-instance
  reading)**: every behavior-test run gets its OWN fresh scratch profile +
  launch, staged by the FD immediately before that run and torn down after —
  each spec's Preconditions demand the Personal+Work seed, and
  `jar-delete-closes-tabs` (run first) destroys it (its last-jar delete leaves
  the registry empty; a reused instance would make `popup-jar-inheritance`'s
  `jarId: "work"` staging throw unknown-jar). The Developer's boot-smoke
  instance is boot-smoke-ONLY: the Developer mints and uses its own key, and
  tears the instance down before finishing. NO instance, port, or key crosses
  the Developer→FD boundary; key values never land in any committed artifact
  (logs record that a key was minted, never the value).

## Inputs

- Commit `7461346` on `flight/03-jar-management-page`: all four legs, suite
  1223/1223, typecheck/lint clean.
- Behavior-test drafts `jar-delete-closes-tabs.md`, `popup-jar-inheritance.md`
  (status `draft`) committed; crew file
  `.flightops/agent-crews/behavior-tests-execution.md` present.

## Outputs

- Boot-smoke results in the flight log; three behavior-test run logs committed
  under `tests/behavior/<slug>/runs/`; both draft specs flipped `draft` →
  `active` on first pass; extended `new-tab-default-routing.md`; CLAUDE.md
  updates; second flight commit.

## Acceptance Criteria

- [x] Boot smoke on a fresh scratch profile: app boots clean (no console/stderr
      errors attributable to F3 surfaces); chrome-eval `window.openJarsPage()`
      opens exactly one internal tab whose enumerated title is
      "Cookie Jars — Goldfinch"; a chrome-eval `jarsAdd`/`jarsRemove` round-trip
      still behaves (registry + broadcast observables consistent). Results
      logged in the flight log with the evidence trail.
- [x] `new-tab-default-routing.md` extended per the three Validator notes
      (explicit reads in steps 1 and 5; post-add `jarsGetDefault` assertion;
      new second-jar-no-claim step); spec remains `active`, table renumbered
      coherently.
- [x] `/behavior-test jar-delete-closes-tabs` — PASS (all checkpoints); run log
      committed; spec → `active`, Last Run stamped.
- [x] `/behavior-test popup-jar-inheritance` — PASS; run log committed; spec →
      `active`, Last Run stamped.
- [x] `/behavior-test new-tab-default-routing` — PASS on the extended spec; run
      log committed; Last Run stamped.
- [x] CLAUDE.md: jars page documented in-structure; pattern note added (both
      patterns, both defect classes, the grep-AC convention — with file
      exemplars). `docs/mcp-automation.md` verified (diff only if it stated
      something now false).
- [x] `npm test` / `npm run typecheck` / `npm run lint` green (docs/spec changes
      shouldn't move them — verify anyway).
- [x] Second flight commit lands this leg's outputs (docs + spec extension +
      run logs + artifacts) after a scoped review.

## Verification Steps

- The behavior-test run logs ARE the machine verification (three PASS logs).
- `git show --stat` of the second commit — confined to docs, behavior specs/run
  logs, flight artifacts.
- Gates re-run post-docs (`npm test`, typecheck, lint).

## Implementation Guidance

(Developer scope — the FD owns the behavior-test runs and their run logs.)

1. **Spec extension first** (so the FD can run the extended spec once the
   instance is staged): edit `tests/behavior/new-tab-default-routing.md` per the
   three notes; keep the Zephyr table conventions from ARTIFACTS.md.
2. **Boot smoke second**: stage your OWN scratch instance per the apparatus
   recipe (mint and use your own key from the stdout print); run the three
   smoke probes — name the round-trip probe jar something clearly distinct from
   the seed names (e.g. "SmokeProbe"), not "work"/"personal"; record results +
   exact commands in the flight log (append-only, no key values); TEAR THE
   INSTANCE DOWN before finishing (kill the launcher node tree by pid). Nothing
   is handed to the FD — it stages fresh per behavior-test run.
3. **Docs third**: CLAUDE.md edits per Context; verify mcp-automation.md.
4. Do NOT run `/behavior-test` yourself; do NOT commit (the second commit comes
   after the FD's runs + scoped review).

## Edge Cases

- **Port drift**: configured 49707 may be taken — discover the bound port from
  the instance's own output/probe.
- **Behavior-test failure**: halt the leg, report to the FD verbatim (the FD
  owns fix-and-rerun sequencing; a failure means a real defect or a spec drift
  — both are flight-log material).
- **CLAUDE.md merge sensitivity**: the pattern note must not restate
  project-specific issue history (that lives in flight artifacts) — patterns
  and conventions only.

## Files Affected

- `tests/behavior/new-tab-default-routing.md` — extended
- `tests/behavior/jar-delete-closes-tabs.md`, `popup-jar-inheritance.md` —
  status `draft` → `active` + Last Run stamped (at first pass)
- `tests/behavior/jar-delete-closes-tabs/runs/`, `popup-jar-inheritance/runs/`,
  `new-tab-default-routing/runs/` — new run logs (FD-produced)
- `CLAUDE.md` (goldfinch) — jars page + pattern note
- `docs/mcp-automation.md` — verify-only (touch iff now-false)
- Flight artifacts — smoke results, leg status, log entries

---

## Citation Audit

This leg cites process facts (commit `7461346`, suite 1223/1223), the DD9
apparatus boundary (verified twice this flight: flight design + Leg 4 review),
the F2 run's Validator notes (quoted from the committed run log
`tests/behavior/new-tab-default-routing/runs/2026-07-10-04-43-55.md`), and the
apparatus recipe (proven live in F1 Leg 4 + F2 Leg 3 + F2 behavior run). No
source-code line anchors are load-bearing in this leg.

## Post-Completion Checklist

**Complete ALL steps before the leg lands:**

- [x] All acceptance criteria verified (three PASS run logs committed)
- [x] Tests passing
- [x] Flight-log entries (smoke + runs + docs)
- [x] Leg status → `landed`; CP4 checked
