# Squawk 0007: `search-engine-preference` step 6 relies on a context-menu sheet the automation surface cannot drive or observe

**Status**: in-progress
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

Re-authored step 6 of `tests/behavior/search-engine-preference.md` (doc-only, no code touched):

- The Actions cell now opens with **`Operator-performed`**, states why (the page-context menu renders in a chrome-owned overlay sheet outside `AUTOMATABLE_MENU_TYPES`, refused by the automation surface at every tier, not composited by `captureWindow`, and no OS-level input tool exists on the dev machine), and assigns the Executor the corroborating role of capturing the resulting tab as evidence — following the established `operator-performed` row convention used elsewhere in this test suite for sheet-interior steps (e.g. `tests/behavior/bookmarks-star-sync.md`'s Preconditions bullet and steps 3/5/6/8/9, `tests/behavior/bookmarks-jar-scoping.md` row 8c). `AUTHORING.md` does not define a bracketed `[operator]` marker (only `[a11y]` and `[mixed-frame]` are defined bracket markers); the codebase's own convention for an apparatus-unreachable, human-performed row is the inline **`operator-performed`** phrase, so that convention was followed instead. (`tests/behavior/welcome-search-handoff.md`, named in the assignment as an alternate reference, does not exist in this repo — confirmed via directory listing.)
- The Expected Results cell now states the verdict is operator-observed, and adds the structural-coverage note: the context menu's `sel:search` dispatch calls the same `toUrl` helper the address-bar rows (2, 4, 5) verify directly via the apparatus.
- Added a matching one-line Preconditions bullet: "**Operator present** — apparatus constraint: … step 6 is operator-performed," citing `src/main/automation/resolve.js:53`.
- Confirmed via `src/main/automation/resolve.js:53` that `AUTOMATABLE_MENU_TYPES = new Set(['bookmarks-overflow', 'bookmark-edit'])` — the page-context sheet is outside the allowlist, so no automatable path exists; re-designing the step around a driveable path was correctly out of scope for this squawk.
- Did not touch the spec's Intent, `**Last Run**` line, `**Status**: active`, or any other row. `Observables Required` left unchanged — the established convention in this suite (`bookmarks-star-sync.md`, `bookmarks-jar-scoping.md`) notes operator-performed rows only in Preconditions, not as a separate Observables Required entry.

## Verification

Read-through of the re-authored row: on every run the row now renders a verdict — an operator-observed pass (or fail) — instead of the apparatus-gap INCONCLUSIVE the first run recorded. The row is honest about its apparatus (names the operator, states the specific allowlist/compositing/OS-input reasons it applies), and the structural-coverage sentence gives the record something the apparatus itself did verify (the shared `toUrl` codepath) rather than resting solely on an unverifiable human claim. This follows the row-convention precedent set by `bookmarks-star-sync.md` and `bookmarks-jar-scoping.md` for sheet-interior steps refused by `automation: secret-sheet` at every tier.

Re-run `/behavior-test search-engine-preference` to confirm live: the re-authored row should render a verdict on every run (operator-observed pass) instead of INCONCLUSIVE.

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
