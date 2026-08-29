# Squawk 0050: Collapse the 19× createSheetEntry injected-dep repetition

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-29
**Completed**: —

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
*(written at completion)*

## Verification
Grep shows a single `sheet` partial defined and the 19 sites routing through it
(no remaining raw `register: menuController.register` at the call sites); full
`node --test` suite stays green (3982), `typecheck`/`eslint`/`prettier` clean.
Behavior-preserving — no test changes expected.

## Sign-Off
*(written at completion)*
