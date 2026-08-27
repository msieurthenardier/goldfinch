# Squawk 0034: Debrief action-item ledger carries ≥9 items as open that are done in the tree

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

The Mission 16 debrief recorded a stale-claim recurrence; this sweep found the pattern is systemic — ~70 unchecked `- [ ]` items across the M07–M15 debriefs, with at least these demonstrably complete: JSON→SQLite migration (M08); automation tool-count invariant consolidation (M08); `__goldfinchNavGuarded` ordering test (M13 → `test/unit/latch-ordering-invariant.test.js`); `docs/vault.md` refresh (M12); jars 4-module reference (M08 → `CLAUDE.md:91`); dual-export ESM shim removal (M07); classifier parity test (BACKLOG → `test/unit/shortcut-classifier-parity.test.js`); the 07-11 `{ok,error}` result-contract advisory; omnibox honest close reasons (M08). Also close on this sweep's evidence: the M16 "fixed-base-commit timing A/B" item (today's 3327–3381 ms for 3792 tests is faster than M16 F2's 3658 ms for 3763 — watch item disproven) and the M09 `tearoff-overlay-manager.js` item (ruled live: constructed in `window-factory.js:246-253`, driven from `register-overlay-ipc.js:707-716`). Tick each with a one-clause annotation and date. Do NOT tick the M16 cache-sync item — it is not done (the `{search}/{home}` override is still in `welcome-controller.js:193-203, :240, :329`).

Source: maintenance report 2026-08-27, finding F37.

## Evidence

- Maintenance report 2026-08-27 §Record corrections — per-item tree evidence
- `missions/0[7-9]-*/mission-debrief.md`, `missions/1[0-5]-*/mission-debrief.md` — the `- [ ]` lines

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
