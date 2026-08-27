# Squawk 0033: GitHub issue tracker is out of sync with shipped work: 3 delivered issues open, defects unlabeled, one issue tracked in three places

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

(1) Close as delivered: #37 configurable search engine (Mission 16, all criteria met), #39 pinnable DevTools (DevTools flight, commit `329df6d`; opens detached, which the issue allowed), #122 bookmarks (Mission 15; note on close that piece 2, the pinnable bookmarks-menu icon, was deliberately dropped by ruling and now rides #113). (2) Apply the `bug` label to the eight unlabeled defect-class issues: #65, #81, #121, #133, #134, #150, #163, #168. (3) Cross-link: #133 ↔ BACKLOG crash seed (canonical #133), #174 ↔ BACKLOG focus seed + M08 H8, #104/#168 ⊂ #147, #143/#144 ↔ the M14 "site trust & permissions" seed; note on #150 that it is the canonical record (the M15 mission SC6/Known Issues and debrief entries point to it). (4) On #113, record the operator ruling of 2026-08-27: the indicator stays where it is and is not made pinnable; the "Lock now" half is tracked as squawk 0038 and #113 closes when it lands.

Source: maintenance report 2026-08-27, findings F52 and F57.

## Evidence

- `missions/16-search-and-startup-choice/mission.md:13,55-64`; `missions/15-bookmarks/mission.md:19,28-38,49`; `git show 329df6d --stat`
- `gh issue list --state open` — 8/20 labeled, none of the defects

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
