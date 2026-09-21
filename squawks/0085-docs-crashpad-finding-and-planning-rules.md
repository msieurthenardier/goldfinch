# Squawk 0085: Docs — Crashpad/SEGV finding, prune race note, two planning rules, DD11 wording

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: 2026-09-21

## Report

Four documentation items from the Flight 3 debrief, all text-only: (1)
CLAUDE.md "Crash and hang resilience": record the finding that with
`crashReporter` active, `SIGSEGV`/`SIGABRT` do not crash a sandboxed guest
renderer on the rig (only `SIGKILL` does) and a SEGV on the unsandboxed chrome
registers after ~15 s — hypothesis Crashpad's in-process handler; consequence: a
real page segfault may present as a hang (operator ruling: documented, not
spiked; revisit if seen); (2) `docs/dev-testing.md` "Crash records and dumps":
one sentence that pruning is not synchronised with Crashpad's own writer (a
theoretical race, accepted); (3) `.flightops/FLIGHT_OPERATIONS.md` or CLAUDE.md
Flight Operations: two standing rules — a leg's live smoke exercises every
existing apparatus primitive against the leg's new state; a DD that installs a
global hook lists and re-runs the earlier spike premises it could change; plus
the "verbatim extraction" TDZ checklist item (anything referenced above the
construction site needs a getter or hoisted declaration); (4) Flight 3
`flight.md` DD11: strike "hung" from the per-tab pushes that call
`refreshTabIndicators` (`onTabHung` never needed to — the chip never reads
`hung`).

## Evidence

- `missions/20-no-silent-failures/flights/03-crash-and-hang-resilience/flight-debrief.md`
  — Technical / Documentation / Recommendations 2–3.
- `tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md` — Orchestrator Notes (SEGV/ABRT finding; SEGV latency).

## Corrective Action

Four text-only edits, no source/test files touched:

1. **CLAUDE.md, "### Crash and hang resilience"** — added a new bullet
   (after the "Kill-and-reload gates on `entry.killRequested`" bullet)
   recording the live-rig finding: with `crashReporter` active,
   `SIGSEGV`/`SIGABRT` do not crash a sandboxed web-guest renderer on this
   rig (only `SIGKILL` does — the guest stayed at `ok`, same pid); a SEGV
   against the unsandboxed chrome renderer DOES crash it but registers only
   after ~15 s (old pid, `booted: true`, until it crashes and recovers
   within one sampling interval) — corroborate by the `chromePid` change,
   not `booted: false`. Stated as a **working hypothesis, not confirmed by
   a spike** (Crashpad's in-process handler runs first under the seccomp
   sandbox and, on the guest, appears to never complete): a real
   page-triggered segfault may therefore present as a hang, not a crash.
   Worded exactly as strongly as the evidence supports — the debrief and
   run-log Orchestrator Notes both hedge this as a hypothesis "for the
   debrief," "needs a spike," so the CLAUDE.md bullet does too.
2. **`docs/dev-testing.md`, "Crash records and dumps" → the Minidumps
   bullet** — appended one sentence: pruning (`pruneDumps`) is not
   synchronised with Crashpad's own dump writer, a theoretical/accepted
   race, never observed causing corruption (matches the debrief's
   "Crashpad artefact count … the prune-vs-live-write race is theoretical
   and undocumented" and the run log's F2 defect note, which was about
   `pruneDumps` not reaching the directory at all — already fixed
   separately — not about a write-vs-prune race).
3. **CLAUDE.md, new "Project-specific planning rules" block directly under
   "## Flight Operations"** (not `.flightops/FLIGHT_OPERATIONS.md` or
   `.flightops/README.md` — both are synced from the plugin and overwritten
   on `init-project`, so a rule living only there would be lost on the next
   sync; CLAUDE.md is project-owned and not touched by that sync). Three
   rules, worded from the debrief's Recommendations 2–3 and the Technical
   section's TDZ finding: (a) a leg's live smoke test exercises every
   existing apparatus primitive against the leg's new state; (b) a DD that
   installs a global hook lists and re-runs the earlier spike premises it
   could change; (c) the verbatim-extraction TDZ checklist item, worded as
   the squawk itself words it ("anything referenced above the construction
   site needs a getter or hoisted declaration").
4. **`missions/20-no-silent-failures/flights/03-crash-and-hang-resilience/flight.md`,
   DD11** — verified against shipped code first
   (`grep -rn refreshTabIndicators src/`): the only callers are the
   failure/security/crash push handlers and tab activation;
   `hang-notice-controller.js`'s `onTabHung` calls `refreshStrip`/`project`,
   never `refreshTabIndicators`. Per the file's own established convention
   for post-hoc fact corrections (blockquoted "**Correction (…)**" notes
   left in place beside the original text, seen elsewhere in this repo's
   flight.md files, e.g. `missions/15-bookmarks/flights/03-drag-interactions/flight.md`),
   added a blockquoted correction directly after the sentence rather than
   silently deleting "hung" from the original prose — the original DD text
   is left intact as the historical record of what was decided/said at the
   time, with the correction visible beside it.

## Verification

- `git diff` reviewed for each of the four files — text-only, no
  source/test file touched (confirmed `git status --porcelain` shows only
  documentation/mission files plus this squawk's own status line changed
  by this work).
- `grep -rn refreshTabIndicators src/` re-run to confirm item 4's
  correction is itself true before writing it (callers: `renderer.js`
  lines 193/664/1224/1255 via `siteSecurityController.refreshTabIndicators`,
  `tab-controller.js:935`, `load-failure-controller.js:387,420`,
  `site-security-controller.js:177` — failure, security, crash, and
  activation only; no `hung` caller).
- `npm run format` (no-op on the four edited files — Prettier reported them
  unchanged/pass) then `npm run format:check` — "All matched files use
  Prettier code style!"
- `npm test` — 5455 pass / 0 fail / 3 todo (5458 total), no change from
  the pre-existing suite state carried from the earlier squawks in this
  turnaround.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
