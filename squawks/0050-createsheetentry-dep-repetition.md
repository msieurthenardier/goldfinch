# Squawk 0050: Collapse the 19× createSheetEntry injected-dep repetition

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-29
**Completed**: 2026-08-29

## Report
Flight 3 converted all 19 sheet registrations to the `createSheetEntry` factory,
which takes its dependencies by injection. As a result every one of the 19 call
sites in `src/renderer/menu-overlay.js` hand-repeats the same two injected
arguments — `register: menuController.register` and the `reportDismissed`
injection — before its sheet-specific `node`/`onOpen`/`onClose`. A thin per-file
partial removes the boilerplate without changing any behavior:

```js
const sheet = (o) => createSheetEntry({ register: menuController.register, reportDismissed, ...o });
```

then each site becomes `sheet({ node, onOpen, onClose, ... })`. Surfaced as an
action item in the Flight 3 debrief
(`missions/17-maintenance/flights/03-sheet-lifecycle-verification/flight-debrief.md`).
Pure cleanup — nothing is broken; the injection is intentional (it is what makes
`createSheetEntry` unit-testable), only its repetition is worth removing.

## Evidence
- `src/renderer/menu-overlay.js` — 19 occurrences of `register: menuController.register`
  (one per `createSheetEntry` call), each paired with the `reportDismissed` injection.
- `src/shared/modal-card-controller.js:createSheetEntry` — the injected-deps factory
  whose signature stays unchanged; the partial is a local convenience only.

## Corrective Action
Introduced a thin per-file partial in `src/renderer/menu-overlay.js`, placed
immediately after the `reportDismissed` binding (so both injected deps are in
scope):

```js
const sheet = (o) => createSheetEntry({ register: menuController.register, reportDismissed, ...o });
```

Rewrote all 19 `createSheetEntry({ register: menuController.register, reportDismissed, ... })`
registrations to `sheet({ ... })`, dropping the two now-defaulted keys at each
site. `...o` is spread last, so any explicit per-site `register`/`reportDismissed`
would still win (none exist today). `createSheetEntry`'s signature and behavior
are unchanged; no other file, test, `resolve.js`, or `AUTOMATABLE_MENU_TYPES`
was touched. Pure, behavior-preserving mechanical dedup.

## Verification
- `grep -c "register: menuController.register" src/renderer/menu-overlay.js` → **1**
  (only inside the `sheet` partial), down from 19.
- `grep -c "createSheetEntry(" src/renderer/menu-overlay.js` → **1** (the partial), down from 19.
- `grep -c "sheet({" src/renderer/menu-overlay.js` → **19** (the converted call sites).
- `npm test` (canonical — globs `test/unit/*.test.js`) → **3982 pass / 0 fail**,
  the metric of record, unchanged before and after. (Bare `node --test` reports
  3988 because node's default discovery also sweeps `test/helpers/*.js`; that is a
  runner-scope difference, not a regression — cite `npm test` as the source of truth.)
- `npm run typecheck`, `npx eslint .`, `npx prettier --check .` → all clean.

Only `src/renderer/menu-overlay.js` (and this artifact) changed.

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the diff)
**Verdict**: confirmed — mechanical, behavior-preserving, complete across all 19
sites, confined to the reported surface; `npm test` 3982/0, typecheck/eslint/prettier clean
**Commit**: `squawk/0050-createsheetentry-dep-repetition` (squash-merged via its PR)
