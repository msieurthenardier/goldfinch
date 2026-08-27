# Squawk 0033: GitHub issue tracker is out of sync with shipped work: 3 delivered issues open, defects unlabeled, one issue tracked in three places

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

(1) Close as delivered: #37 configurable search engine (Mission 16, all criteria met), #39 pinnable DevTools (DevTools flight, commit `329df6d`; opens detached, which the issue allowed), #122 bookmarks (Mission 15; note on close that piece 2, the pinnable bookmarks-menu icon, was deliberately dropped by ruling and now rides #113). (2) Apply the `bug` label to the eight unlabeled defect-class issues: #65, #81, #121, #133, #134, #150, #163, #168. (3) Cross-link: #133 ↔ BACKLOG crash seed (canonical #133), #174 ↔ BACKLOG focus seed + M08 H8, #104/#168 ⊂ #147, #143/#144 ↔ the M14 "site trust & permissions" seed; note on #150 that it is the canonical record (the M15 mission SC6/Known Issues and debrief entries point to it). (4) On #113, record the operator ruling of 2026-08-27: the indicator stays where it is and is not made pinnable; the "Lock now" half is tracked as squawk 0038 and #113 closes when it lands.

Source: maintenance report 2026-08-27, findings F52 and F57.

## Evidence

- `missions/16-search-and-startup-choice/mission.md:13,55-64`; `missions/15-bookmarks/mission.md:19,28-38,49`; `git show 329df6d --stat`
- `gh issue list --state open` — 8/20 labeled, none of the defects

## Corrective Action

1. Closed #37 as completed, with a comment attributing delivery to Mission 16 (v0.14.0) and noting the issue's own out-of-scope items (custom templates, per-jar engines, suggestions) were never promised.
2. Closed #39 as completed, with a comment attributing delivery to the DevTools flight (commit `329df6d`, PR #60) and noting it opens detached rather than as a slide-out, which the issue allowed.
3. Closed #122 as completed, with a comment attributing delivery to Mission 15 and noting piece 2 (pinnable bookmarks-menu icon) was dropped by design ruling, residual question tracked in #113.
4. Added the `bug` label to #65, #81, #121, #133, #134, #150, #163, #168 (label pre-existed; confirmed via `gh label list` before applying).
5. Commented on #133: canonical record for the crash/sleep-resume seed; BACKLOG.md now points here.
6. Commented on #174: supersedes the BACKLOG "Internal-page keyboard focus" seed and Mission 08's H8 item; scheduled as Mission 17 Flight 1.
7. Commented on #104: sub-gap of #147 (fingerprinting audit mission), stays open as field evidence; plus a second comment noting the burner-only `disable_non_proxied_udp` policy shipped via squawk 0036 (PR #177), normal-tab policy question remains open.
8. Commented on #168: sub-gap of #147 (fingerprinting audit mission), stays open as field evidence.
9. Commented on #150: canonical record — Mission 15's SC6 / Known Issues and debrief entries point here.
10. Commented on #143: paired with the Mission 14 "site trust & permissions" seed; #163 sequenced first.
11. Commented on #144: paired with the Mission 14 "site trust & permissions" seed; #163 sequenced first.
12. Commented on #113 (not closed): recorded the operator ruling of 2026-08-27 — indicator stays put, not made pinnable; "Lock now" context menu implemented as squawk 0038 (PR #178); issue closes when that PR merges.
13. Commented on #81 (not closed): fix in PR #177 (squawk 0035).
14. Commented on #121 (not closed): fix in PR #177 (squawk 0017).
15. Commented on #134 (not closed): item 3 (orphan guest view) fixed in PR #177 (squawk 0018); items 1-2 remain.

## Verification

- `gh issue list --state open --json number,labels`: 17 open issues (down from 20 — #37, #39, #122 closed); 9 carry the `bug` label (8 newly labeled here plus #174, which already had it).
- `gh issue view 37 --json state` → `CLOSED`
- `gh issue view 39 --json state` → `CLOSED`
- `gh issue view 122 --json state` → `CLOSED`
- `gh issue view 113 --json state` → `OPEN` (left open per instruction; closes on PR #178 merge)

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
