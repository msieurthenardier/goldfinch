# Flight Log: Doc Promotions

**Flight**: [Doc Promotions](flight.md)

## Summary

*(not started)*

---

## Reconnaissance Report (2026-07-11, pre-design)

Source items walked against the current tree (post-Flight-2, main @ 5a3d8eb).
Sources: maintenance report 2026-07-11 finding 5 (doc promotions), F1 debrief
action item (MockTimers), F2 debrief Recommendations 1–3.

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| 1. Uniform focus rule (M06 F4 DD6) | confirmed-live | Absent from CLAUDE.md; the target section `### Cross-view focus + tab-type idioms` exists (CLAUDE.md:200) with two conventions, no patch-in-place rule | Keep as planned |
| 2. `action:rowId` confirm-transition key (M06 F4 leg 3 review) | confirmed-live | No mention anywhere in CLAUDE.md (grep `rowId`/confirm-transition → 0 relevant hits) | Keep as planned |
| 3. DD10(b) checklist rewrite | confirmed-live — scope WIDENED by F2 debrief Rec 1 | CLAUDE.md:69 is pointer-only (as F2 left it); but `### src/shared/ dual-export predicate` (:38–51) and the dual-export half of `### Recurring module shapes` (:62–76) still describe the retired world; :74 calls the vm-replay nets "current exemplars" (they are script-tag contract tests since F2 leg 6); two further stale `dual-export` attributions at :142 (`page-context-model.js`) and :150 (`sheet-accelerator.js`) — both converted to ESM in F2 | Widen edit 3 from "rewrite the checklist" to "rewrite the shared-module story": both stale sections + a full-file `dual-export`/`typeof module` sweep; new content per F2 debrief (ESM pattern, PRELOAD-REACHABLE + parse-guard pair, flat-served import rule, seam closed-set rule, DD3-as-permanent) |
| 4. MockTimers recipe (F1 debrief action item) | confirmed-live | Absent (grep `MockTimers` → 0); recipe lives only in the landed F1 leg 1 spec | Add as fourth edit (mission.md Flight-3 bullet already annotated) |
| 5. Behavior-test AUTHORING.md pointer verification | already-satisfied (note-only) | Mission-control-side commit already landed; no goldfinch-side action existed to begin with | Note in flight log at execution, per the original spec |
| R2. Require-cache unit test (F2 debrief Rec 2) | confirmed-live candidate | No test pins the preload-graph-ESM-free invariant; `require.cache` idiom precedent exists (`test/unit/settings-store.test.js:37`) | Operator decision: ride this flight or defer |
| R3. Seam-contract static test (F2 debrief Rec 3) | confirmed-live candidate | Seam is one statically-parseable `Object.assign(globalThis, {…})` block at the tail of `src/renderer/renderer.js`; `scripts/a11y-audit.mjs` drives entries via literal `evaluate(client, wcId, '<name>(…)')` strings — both sides greppable without a boot | Operator decision: ride this flight or defer |

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### Flight design session (2026-07-11)

- Reconnaissance pass (report above) against main @ 5a3d8eb: all source
  items confirmed-live; edit 3 widened per F2 debrief Rec 1; operator
  ruled both F2-debrief test recommendations (Recs 2–3) onto this flight
  as leg 2 (`invariant-pins`).
- Architect design review (probe-based, read-only): **approve with
  changes**. All CLAUDE.md line anchors verified byte-accurate; DD3(a)
  require-cache mechanics empirically confirmed (require(esm) lands a
  readable `require.cache` entry under `node --test`; synthetic
  violation detected; `node --test` per-file process isolation rules out
  cache pollution; `automation-dev.js`/`internal-page.js` have zero own
  requires today — pure forward pin). One medium issue folded into DD3:
  seam extraction must be two-tier (direct `evaluate` literals + the
  `SHEET_STATES` `open:` literals — naive pattern recovers only 6/11
  identifiers). Two suggestions folded into leg-1 guidance: preserve the
  still-true `guest-forward-allowlist.js` sentence; fix the seam's
  `openContainerOverlay` consumer tag (comment-only `src/` edit,
  sanctioned in the spec's Verification section). Fixes adopted verbatim
  from the reviewer's probe-proven recommendations — second review cycle
  skipped.
