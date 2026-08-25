# Squawk 0007: `search-engine-preference` step 6 relies on a context-menu sheet the automation surface cannot drive or observe

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-24
**Completed**: —

## Report

`tests/behavior/search-engine-preference.md` step 6 ("right-click it, and choose the *Search for …* item") is unreachable by the goldfinch MCP apparatus: the page-context menu renders in a chrome-owned sheet that is refused for every op at every identity tier and is not composited by `captureWindow`, and no OS-level input tool exists on the dev machine. The row's first run was INCONCLUSIVE on the apparatus gap and was closed by an operator check at the debrief. Re-author the row so the record is honest on every run: name the operator check as the row's apparatus (an `[operator]` row, per the AUTHORING guide's conventions for steps no apparatus can reach), or drive the same command through an automatable path if one exists. Found at the M16 F1 flight debrief (2026-08-24).

## Evidence

- `src/main/automation/resolve.js:53` — `const AUTOMATABLE_MENU_TYPES = new Set(['bookmarks-overflow', 'bookmark-edit']);` — page-context (and kebab) sheets are outside the allowlist.
- `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md` — checkpoint 6: six ops against the sheet refused verbatim with `automation: secret-sheet — wcId 3 is a chrome-owned secret/overlay sheet and is never automatable (any tier)`; window capture showed no menu; verdict inconclusive (rule 5); operator-verified pass recorded in Operator Notes.
- `src/renderer/renderer.js` — `page-context` case of the sheet-activation dispatch: `id === 'sel:search'` → `createTab(toUrl(p.selectionText), srcContainer)` — the same `toUrl` the address-bar rows verify.

## Corrective Action
*(written at completion)*

## Verification
Re-run `/behavior-test search-engine-preference`: the re-authored row renders a verdict on every run (operator-observed pass, or apparatus pass via the alternate path) instead of INCONCLUSIVE.

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
