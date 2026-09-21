# Squawk 0094: Squawks 0090 and 0091 still read "Reviewer: pending" post-merge

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

## Report

Squawks 0090 and 0091 were implemented inside Mission 21 Flight 2 Leg 1 and merged
in `016e540`, but their `## Sign-Off` sections still read `**Reviewer**: pending`
and their `**Commit**` lines still read "uncommitted at leg-implementation time".

This was **not** an oversight at write time. Each sign-off carries an explicit
clause that the end-of-flight review "will amend this section if it finds
otherwise" — an *adverse-only* amend. The flight-end review found nothing adverse,
so the amend never fired and the record is permanently pending by construction.

Two halves: (a) back-fill the two records with the actual reviewer verdict and
commit; (b) make the clause unconditional — amend on *any* outcome — so a clean
review does not leave a stale artifact next time.

Found during the Flight 2 debrief (2026-09-20).

## Evidence

`squawks/0090-expiry-fallback-false-positives.md:176-186` and
`squawks/0091-fallback-underscore-prefix-blocks-match.md:129-133` — both read
`**Reviewer**: pending … will amend this section if it finds otherwise`.

The review that should have closed them: PR #226's flight-end Reviewer pass,
merged as `016e540` (2026-09-20), which reported no blocking issues.

## Corrective Action
*(written at completion)*

**(a) Back-filled.** `squawks/0090-expiry-fallback-false-positives.md` and
`squawks/0091-fallback-underscore-prefix-blocks-match.md` had their `## Sign-Off`
sections rewritten with the real record: reviewed as part of PR #226's flight-end
review (no blocking issues reported), landed in commit `016e540`. Verified first:
`git log --oneline -1 016e540` → `016e540 flight/02: Identity Foundations
(Mission 21) (#226)`; `git show --stat 016e540 -- squawks/` → both files listed
as changed in that commit. Format matched against completed squawks' own
Sign-Off sections (`squawks/0073-…`, `squawks/0037-…`, `squawks/0001-…`):
**Reviewer** / **Verdict** / **Commit** fields, no placeholder prose.

**(b) NOT done — reverted the search, made no edit, per the Scope gate.**
Grepped for `amend` across every candidate location the squawk names and every
one this agent could additionally find:
- `.flightops/ARTIFACTS.md`'s Squawk template (`## Sign-Off` block, lines
  319-324): no "amend" language at all — it's a plain
  `**Reviewer**: … **Verdict**: confirmed **Commit**: …` template that assumes
  the real reviewer/commit are already known at write time.
- `.flightops/agent-crews/leg-execution.md`'s Developer: Commit prompt: no
  "amend" language; no mention of squawks at all.
- `.flightops/FLIGHT_OPERATIONS.md` (plugin-synced) and `.flightops/README.md`
  (plugin-synced): the former's "Squawks" section states "Every completed
  squawk gets an independent Reviewer, however trivial the change… but it
  always happens" — a Reviewer-always rule, but not the "will amend this
  section if it finds otherwise" clause, and not conditional in the way 0090/
  0091's Sign-Offs were.
- The upstream plugin package itself (`~/.claude/plugins/cache/flight-control/
  mission-control/{1.0.0,1.0.1}/skills/squawk/SKILL.md` and
  `docs/squawks.md`, outside this repo entirely): same finding —
  "### The Sign-Off Is Non-Negotiable" states every completed squawk gets an
  independent Reviewer; no "amend" wording, no adverse-only conditional, and
  no treatment of the scenario 0090/0091 actually hit (a squawk *escalated
  into* a flight and closed inside one of the flight's batched-review legs,
  rather than closed through the standalone `/mission-control:squawk` flow
  the skill and docs describe).

**Finding: the clause does not live in any template, project-owned or
plugin-synced.** It is freeform prose the Leg 1 Developer wrote directly into
0090 and 0091's own Sign-Off sections (worded near-identically in both, so
clearly composed once and reused, not independently invented twice) to explain
why real Reviewer/Commit values weren't yet knowable at squawk-completion
time — Flight 2 batches its code review to the end of the flight, but the
squawk skill and this project's `ARTIFACTS.md` template both assume a
squawk's real Sign-Off is written once, at completion, with the actual verdict
already in hand. Neither document describes what a Developer should write when
those two timings diverge (squawk closed mid-leg vs. review at flight-end).

Because there is no existing conditional clause anywhere to flip to
unconditional, closing (b) faithfully means *authoring* new guidance for a
scenario no artifact currently addresses — and deciding where that guidance
should live (a new note in `ARTIFACTS.md`'s Squawk Sign-Off template? a step
added to `leg-execution.md`'s Developer: Commit prompt requiring any
leg-closed squawks' Sign-Offs to be amended at that same commit, now that the
real reviewer/commit are known? something else?) is a process design
question about how the squawk lifecycle interacts with a flight's batched
review — exactly the Scope gate's carve-out. Per the Scope gate: completed
part (a), made no part (b) edit (nothing to revert), and record this as an
item for a Flight Director / human decision or an upstream
mission-control methodology change, rather than inventing new project
process unilaterally inside a routine documentation squawk.

## Verification

- `git log --oneline -1 016e540` → `016e540 flight/02: Identity Foundations
  (Mission 21) (#226)`.
- `git show --stat 016e540 -- squawks/` → confirms both
  `squawks/0090-expiry-fallback-false-positives.md` and
  `squawks/0091-fallback-underscore-prefix-blocks-match.md` were modified in
  that commit (108 and 76 insertions respectively — each squawk's own
  Corrective Action/Verification/Sign-Off write-up landing).
- `git diff --stat` confirms only 0090, 0091, and this file (0094) changed in
  this squawk's own working-tree edits — no source or test file touched.
- `npm run format` — no changes (`squawks/**/*.md` is covered by the repo-wide
  `*.md` entry in `.prettierignore`, so Markdown is out of Prettier's scope
  entirely); `npm run format:check` — "All matched files use Prettier code
  style!".
- `npm test` (full suite): 5458 tests, 5455 pass / 0 fail / 3 pre-existing
  todo, 25 suites — matches the pre-existing todo count noted elsewhere in
  this batch; no regressions from a docs-only change.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean; part (a) confirmed against `git show --stat 016e540`; part (b) not changed — the reviewer confirmed no conditional amend clause exists in any `.flightops/` file, so making it unconditional is a process-design question left to the operator (see Corrective Action)
**Commit**: see `squawk: turnaround 2026-09-21`
