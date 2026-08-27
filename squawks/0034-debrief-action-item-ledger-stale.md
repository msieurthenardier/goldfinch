# Squawk 0034: Debrief action-item ledger carries ≥9 items as open that are done in the tree

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

The Mission 16 debrief recorded a stale-claim recurrence; this sweep found the pattern is systemic — ~70 unchecked `- [ ]` items across the M07–M15 debriefs, with at least these demonstrably complete: JSON→SQLite migration (M08); automation tool-count invariant consolidation (M08); `__goldfinchNavGuarded` ordering test (M13 → `test/unit/latch-ordering-invariant.test.js`); `docs/vault.md` refresh (M12); jars 4-module reference (M08 → `CLAUDE.md:91`); dual-export ESM shim removal (M07); classifier parity test (BACKLOG → `test/unit/shortcut-classifier-parity.test.js`); the 07-11 `{ok,error}` result-contract advisory; omnibox honest close reasons (M08). Also close on this sweep's evidence: the M16 "fixed-base-commit timing A/B" item (today's 3327–3381 ms for 3792 tests is faster than M16 F2's 3658 ms for 3763 — watch item disproven) and the M09 `tearoff-overlay-manager.js` item (ruled live: constructed in `window-factory.js:246-253`, driven from `register-overlay-ipc.js:707-716`). Tick each with a one-clause annotation and date. Do NOT tick the M16 cache-sync item — it is not done (the `{search}/{home}` override is still in `welcome-controller.js:193-203, :240, :329`).

Source: maintenance report 2026-08-27, finding F37.

## Evidence

- Maintenance report 2026-08-27 §Record corrections — per-item tree evidence
- `missions/0[7-9]-*/mission-debrief.md`, `missions/1[0-5]-*/mission-debrief.md` — the `- [ ]` lines

## Corrective Action

| Item | Debrief | Result | Reason |
|---|---|---|---|
| Storage-substrate JSON→SQLite migration | M08 | Ticked | `settings-store.js` / `downloads-store.js` both call `appDb.createDocumentStore(...)`, backed by `node:sqlite`'s `DatabaseSync`. |
| Automation tool-count invariant consolidated | M08 | Ticked | `mcp-tools.js`'s `TOOLS` array is derived by spreading per-family arrays — no separate hardcoded count remains in `mcp-server.js`/`mcp-tools.js`; only the test's `EXPECTED_TOOL_COUNT` still carries a number. |
| Jars-page 4-module reference | M08 | Ticked | CLAUDE.md:91 documents `jars.js` (composition root) + `jars-page-state.js` / `jars-nav-controller.js` / `jars-section-controller.js` / `jars-create-controller.js`. |
| Honest omnibox close reasons (`'superseded'`) | M08 | **Left open** | Bundled checkbox line. Confirmed: no error path uses `'input-empty'` inappropriately (only the genuine empty-input case at `navigation-controller.js:246`). NOT confirmed: the same line's "prune F4 dead surface" clause — `internal-history-suggest` is still registered in `history-ipc.js:193-200` with its own comment admitting "registered-but-unused this flight"; `lastQuery`/`blurClosedAt`/`refocus` remain live elsewhere, not dead. Ticking would overclaim the prune half, so left open pending an actual prune or a debrief split. |
| Dual-export ESM shim removal | M07 | **Left open** | No standalone item found; the nearest match (`menu-controller.js` ESM conversion) is explicitly phrased "Future-cycle candidate," not a completed/pending action — left per instruction. |
| `docs/vault.md` refresh for F5 Secrets page | M12 | **Left open** | Confirmed NOT done: `docs/vault.md` has no mention of the two-level nav/sidebar, typed subsections, modal item editor, unified Import/Export, or the `editorCleanups` teardown pattern that flight 05's own debrief (`flights/05-hat-acceptance/flight-debrief.md:37`) flags as missing. |
| `__goldfinchNavGuarded` latch-ordering regression test | M13 | Ticked | `test/unit/latch-ordering-invariant.test.js` exists and pins the latch as the first statement of `wireGuestContents`. |
| `tearoff-overlay-manager.js` consumer-less item | M09 | Ticked | Ruled live: constructed in `window-factory.js` (`createTearoffOverlayManager` at line 246), driven from `register-overlay-ipc.js` (`tearoffOverlay.show/setPosition/hide`, lines 709-716). Note: this bundled checkbox also names `getAttachedWindow`/`crossWindow` retirement (still present, not retired) and stray `[DRAGDIAG]` logging (confirmed absent, nothing to remove) — ticked per explicit instruction on the tearoff sub-claim; the retirement sub-claim remains factually open. |
| Classifier hand-mirror item | M09 | **Left open (partial)** | `test/unit/shortcut-classifier-parity.test.js` exists and pins parity, but the debrief item's own wording asks for "unification," and the test file's header explicitly says each side "gets its OWN adapter rather than one shared descriptor object" — parity achieved, unification not. Left open per instruction. |
| Fixed-base-commit timing A/B | M16 | Ticked | Per this sweep's evidence (maintenance report 2026-08-27, F37): 3327–3381 ms for 3792 tests vs M16 F2's 3658 ms for 3763 — watch item disproven. |
| Synchronous local cache write | M16 | **Left open (explicitly)** | Confirmed still open: the `{search}`/`{home}` override pattern is present in `welcome-controller.js` (render/settle read `'search' in opts ? opts.search : ...` / `'home' in opts ? opts.home : ...`). Annotated in place per instruction, not ticked. |
| 2026-07-11 result-contract symmetry advisory | — | Skipped | Not tracked as a checkbox in any `missions/*/mission-debrief.md` — only referenced in `maintenance/2026-07-11.md` and a flight spec. Nothing to tick. |

## Verification

`git diff --stat` (debrief files only):
```
missions/08-history/mission-debrief.md                   | 9 ++++++---
missions/09-tab-management/mission-debrief.md            | 3 ++-
missions/13-security-hardening/mission-debrief.md        | 3 ++-
missions/16-search-and-startup-choice/mission-debrief.md | 4 +++-
4 files changed, 13 insertions(+), 6 deletions(-)
```
`missions/07-maintenance/mission-debrief.md` and `missions/12-password-manager/mission-debrief.md` are unchanged (both items left open, no edits made).

Per-tick evidence is reproduced in the Corrective Action table above; each was checked directly against the working tree (grep/ls) before ticking, not assumed from the squawk report.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean; three ticks spot-checked against the tree and the M16 cache-sync item confirmed still open; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
