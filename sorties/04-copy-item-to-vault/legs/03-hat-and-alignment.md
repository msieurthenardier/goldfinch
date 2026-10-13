# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Copy a Vault Item to Another Vault](../flight.md)

## Objective
Verify the copy-to flow on the real app with the operator: run the `vault-copy-item` behavior test (including its step-0 live smoke) on Goldfinch dev mode, then walk the by-eye items no automated check covers, fixing what the operator wants fixed.

## Context
- Interactive leg: the Flight Director guides the operator one step at a time; no autonomous implementation. Fixes route through the fix-vs-feature gate (a new behavior → scoped design review first; a multi-surface "cosmetic" fix → a lightweight Developer design-review pass first).
- Apparatus (flight DD11, operator ruling 2026-10-12): Goldfinch dev mode (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`), admin key captured per launch, `connectAutomation()` scripts — not the registered `goldfinch-dev` MCP server. The vault under test is the DEV profile's.
- Contract readers: `tests/behavior/vault-copy-item.md` pins selectors (`vault-copy-resolution` radios, `.vault-page-notice`), modal titles and notice texts. A HAT change to any of them is a spec re-author, done deliberately in this leg — not an inline fix.
- Carried alignment items: step-2 submit label is a fixed "Apply" (leg 2 deviation); the stale-choice status line is unit-only (flight review note 2).
- **Squawk 0104** (open): ES-module edits on internal pages stay stale until the app is relaunched — relaunch after any page fix.

## Acceptance Criteria
- [x] H1 Dev mode launched, admin key captured, `connectAutomation()` attach confirmed (`enumerateTabs`); operator unlocked the dev profile's vault; preconditions of `vault-copy-item` met (two persistent jars, one without a vault file).
- [x] H2 `/mission-control:behavior-test vault-copy-item` passes (steps 0-13 incl. 10a), run log committed under `tests/behavior/vault-copy-item/runs/`; spec status `draft` → `active`.
- [x] H3 By eye — the Copy-to icon reads as distinct from the clipboard icon and sits between Edit and Delete.
- [x] H4 By eye — step 1 (destination list, labels) and step 2 (radio group on the dark theme, message, overwrite warning) look right; operator rules on the fixed "Apply" label.
- [x] H5 By eye — the stale-choice line: with step 2 open, change the destination in a second window (or via the console), then Apply → step 2 re-renders with "This vault changed since you chose — please choose again."
- [x] H6 By eye — keyboard: Tab to Copy-to, Enter, choose, Escape from step 2 → focus returns to the row's Copy-to button (focus ring is by eye on WSLg; `document.hasFocus()` reads false on internal pages here).
- [x] H7 By eye — a second window open on the destination vault stays stale until its own refresh (accepted behavior, DD9) and nothing in it breaks.
- [x] H8 Operator accepts.

## Verification Steps
One step at a time, operator-reported, FD-observed where the apparatus can.

## Files Affected
- Only what HAT fixes require (recorded in the flight log).

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
