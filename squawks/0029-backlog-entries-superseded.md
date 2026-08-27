# Squawk 0029: `BACKLOG.md` carries three entries superseded by shipped work or tracked issues

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Three BACKLOG.md seeds no longer describe reality: (1) "Electron major bump: 42 → 43" (`:264-283`) still frames the bump as deferred — it merged 2026-07-24 (PR #125); (2) "Internal-page keyboard focus" (`:286-304`) is superseded by GitHub issue #174, which absorbs it and the M08 debrief's H8 item; (3) "Renderer crash / sleep-resume resilience" (`:186-244`) is duplicated by issue #133, which has newer acceptance criteria and file:line cites. Retire (1); reduce (2) and (3) to one-line pointers naming the canonical issue.

Source: maintenance report 2026-08-27, findings F36 and F57.

## Evidence

- `package.json` — `"electron": "^43.2.0"`; `BACKLOG.md:264-283` — "deliberately deferred … next full-category maintenance sweep"
- Issues #174 (filed 2026-08-26) and #133 (2026-07-24) — see maintenance report §Issue Triage

## Corrective Action

- **Electron major bump: 42 → 43** — retired entirely (heading + body removed; shipped in PR #125,
  `package.json` now `"electron": "^43.2.0"`). Its one residual instruction ("re-run the
  behavior-test net after the bump") was not moved anywhere: `.github/dependabot.yml`'s standing
  comment already mandates `/behavior-test core-browsing-shields` and `/behavior-test
  tab-scheme-guard` as the manual runtime gate on every future Electron major PR, so the note would
  be a duplicate. The bump-specific `node:sqlite`/`ExperimentalWarning` re-check note was tied to
  that specific bump (now merged) and not carried forward.
- **Internal-page keyboard focus** — heading kept; body replaced with a one-line pointer: "Tracked
  in #174 (which absorbs this seed and M08 H8); see Mission 17 Flight 1." Confirmed #174's body and
  AC explicitly absorb this seed and M08 H8, and `missions/17-maintenance/mission.md` Flight 1
  cites both.
- **Renderer crash / sleep-resume resilience** — heading kept; `### The gap`, `### Fix shape`, and
  `### Scope notes` replaced with a one-line pointer to #133 as canonical (newer AC + file:line
  cites, confirmed via `gh issue view 133`). `### The incident (the evidence)` was kept verbatim:
  issue #133's body only references the incident ("Related: BACKLOG.md:186-244 — the original seed
  and post-mortem, including the sleep-resume detail") without reproducing the diagnosis narrative
  (the bugcheck code, the forensics-wall finding, etc.), so the evidence subsection stays under the
  pointer per the squawk's instruction.
- All other BACKLOG.md entries left byte-identical (only the three targeted sections were touched).

## Verification

- `grep -rn "Electron major bump" docs missions CLAUDE.md README.md BACKLOG.md` — no remaining
  references to the removed heading itself; the historical mentions in
  `missions/08-history/...`, `missions/10-persistence-consolidation/...`, and `CLAUDE.md` are prose
  about the general "Electron major bump" recurrence-tax concept (not links to the BACKLOG heading)
  and were left untouched, out of scope.
- `gh issue view 174` and `gh issue view 133` — confirmed absorption/supersession claims before
  editing.
- `npx prettier --check BACKLOG.md` — passes (`All matched files use Prettier code style!`).
- Diff scoped to `BACKLOG.md` only (plus this squawk artifact); no source files touched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
